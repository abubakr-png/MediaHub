// MediaHub server — без зависимостей, Node.js 18+. Запуск: npm start
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const dns = require("dns").promises;
const net = require("net");

const PORT = Number(process.env.PORT) || 3000;
const MAX_BYTES = 200 * 1024 * 1024;
const MEDIA_TYPE = /^(image|video|audio)\//i;
const MEDIA_EXT = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp|aac|flac|m4a|mp3|oga|ogg|opus|wav|avi|m4v|mkv|mov|mp4|mpeg|mpg|webm)$/i;
const RATE_LIMIT = new Map();

function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && c === 0))) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0 && c === 113);
  }

  if (!net.isIPv6(ip)) return true;
  const normalized = ip.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice(7);
    if (net.isIPv4(mapped)) return isPrivate(mapped);
    return true;
  }
  const first = parseInt(normalized.split(":")[0] || "0", 16);
  // Only global-unicast IPv6 (2000::/3) is allowed. Documentation space is excluded.
  return first < 0x2000 || first > 0x3fff || normalized.startsWith("2001:db8:");
}

async function requestPublicMedia(urlString, redirects = 0) {
  let url;
  try { url = new URL(urlString); } catch { throw new Error("Укажи корректную ссылку."); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new Error("Разрешены только публичные HTTP(S)-ссылки без логина и пароля.");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(hostname)
    ? [{ address: hostname, family: net.isIP(hostname) }]
    : await dns.lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivate(address))) {
    throw new Error("Адрес назначения не разрешён.");
  }

  const destination = addresses[0];
  const transport = url.protocol === "https:" ? https : http;
  const response = await new Promise((resolve, reject) => {
    const outgoing = transport.get(url, {
      timeout: 20000,
      headers: { "User-Agent": "MediaHub/1.0", Accept: "image/*,video/*,audio/*,application/octet-stream;q=0.8" },
      lookup: (_host, options, callback) => options && options.all
        ? callback(null, [destination])
        : callback(null, destination.address, destination.family),
    }, resolve);
    outgoing.on("timeout", () => outgoing.destroy(new Error("Таймаут соединения.")));
    outgoing.on("error", reject);
  });

  if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
    response.resume();
    if (redirects >= 3) throw new Error("Слишком много перенаправлений.");
    return requestPublicMedia(new URL(response.headers.location, url).href, redirects + 1);
  }

  return { response, url };
}

function sendText(res, status, message) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });
  res.end(message);
}

async function handleDownload(req, res, query) {
  const ip = req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const recent = (RATE_LIMIT.get(ip) || []).filter((time) => now - time < 60000);
  if (recent.length >= 30) return sendText(res, 429, "Слишком много запросов. Подожди минуту.");
  recent.push(now);
  RATE_LIMIT.set(ip, recent);

  let upstream;
  try {
    const result = await requestPublicMedia(query.get("url") || "");
    upstream = result.response;
    const { url } = result;
    const contentType = String(upstream.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    const isMedia = MEDIA_TYPE.test(contentType) || (contentType === "application/octet-stream" && MEDIA_EXT.test(url.pathname));
    const size = Number(upstream.headers["content-length"] || 0);

    if (upstream.statusCode !== 200) {
      upstream.resume();
      return sendText(res, 502, `Источник ответил кодом ${upstream.statusCode || "unknown"}.`);
    }
    if (!isMedia) {
      upstream.destroy();
      return sendText(res, 415, "Ссылка должна вести напрямую на фото, видео или аудиофайл; страницы соцсетей и стриминговых сервисов не поддерживаются.");
    }
    if (size > MAX_BYTES) {
      upstream.destroy();
      return sendText(res, 413, "Файл больше допустимого лимита 200 МБ.");
    }

    let filename = "mediahub-file";
    try { filename = decodeURIComponent(url.pathname.split("/").pop() || filename); } catch {}
    filename = filename.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 150) || "mediahub-file";

    const headers = {
      "Content-Type": contentType || "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    };
    if (size) headers["Content-Length"] = size;
    res.writeHead(200, headers);

    let received = 0;
    upstream.on("data", (chunk) => {
      received += chunk.length;
      if (received > MAX_BYTES) {
        upstream.destroy();
        res.destroy();
      }
    });
    upstream.on("error", () => res.destroy());
    req.on("aborted", () => upstream.destroy());
    res.on("close", () => { if (!res.writableEnded) upstream.destroy(); });
    upstream.pipe(res);
  } catch (error) {
    if (upstream && !upstream.destroyed) upstream.destroy();
    sendText(res, 400, error.message || "Не удалось получить файл.");
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
};

function sendStatic(res, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return sendText(res, 400, "Некорректный путь."); }
  if (decoded === "/privacy") decoded = "/privacy.html";
  const root = path.resolve(__dirname);
  const file = path.resolve(root, `.${decoded === "/" ? "/index.html" : decoded}`);
  const relative = path.relative(root, file);
  if (relative.startsWith("..") || path.isAbsolute(relative) || /(^|[\\/])\./.test(relative) || ["server.js", "package.json"].includes(path.basename(file))) {
    return sendText(res, 403, "Forbidden");
  }

  fs.stat(file, (statError, stats) => {
    if (statError || !stats.isFile()) return sendText(res, 404, "Not found");
    res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "X-Content-Type-Options": "nosniff" });
    fs.createReadStream(file).on("error", () => { if (!res.headersSent) sendText(res, 500, "Не удалось прочитать файл."); else res.destroy(); }).pipe(res);
  });
}

http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, "http://localhost"); } catch { return sendText(res, 400, "Некорректный запрос."); }
  if (url.pathname === "/api/download") {
    if (req.method !== "GET") return sendText(res, 405, "Метод не поддерживается.");
    return handleDownload(req, res, url.searchParams);
  }
  if (req.method !== "GET" && req.method !== "HEAD") return sendText(res, 405, "Метод не поддерживается.");
  if (req.method === "HEAD") {
    const originalWriteHead = res.writeHead.bind(res);
    res.writeHead = (...args) => originalWriteHead(...args);
    return sendStatic(res, url.pathname);
  }
  sendStatic(res, url.pathname);
}).listen(PORT, "0.0.0.0", () => console.log(`MediaHub listening on port ${PORT}`));
