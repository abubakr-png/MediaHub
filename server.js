// MediaHub server — без зависимостей, Node.js 18+.  Запуск: node server.js
const http = require("http"), https = require("https"), fs = require("fs"), path = require("path");
const dns = require("dns").promises, net = require("net");

const PORT = process.env.PORT || 3000;
const MAX_BYTES = 200 * 1024 * 1024;            // лимит размера файла
const ALLOWED = /^(image|video|audio)\//;       // только медиа
const hits = new Map();                         // простой rate limit: 30 запросов / минуту на IP

function isPrivate(ip) {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l.startsWith("::ffff:")) return isPrivate(l.slice(7));
    return l === "::1" || l === "::" || /^(fc|fd|fe[89ab])/.test(l);
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

// Подключение только к проверенному публичному IP (защита от SSRF и DNS-rebinding)
async function open(urlStr, redirects = 0) {
  const url = new URL(urlStr);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Только http(s)-ссылки");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some(a => isPrivate(a.address))) throw new Error("Адрес не разрешён");
  const target = addrs[0];
  const lib = url.protocol === "https:" ? https : http;
  const res = await new Promise((resolve, reject) => {
    const req = lib.get(url, {
      timeout: 15000, headers: { "User-Agent": "MediaHub/1.0" },
      lookup: (h, o, cb) => o && o.all ? cb(null, [target]) : cb(null, target.address, target.family),
    }, resolve);
    req.on("timeout", () => req.destroy(new Error("Таймаут")));
    req.on("error", reject);
  });
  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
    res.resume();
    if (redirects >= 3) throw new Error("Слишком много перенаправлений");
    return open(new URL(res.headers.location, url).href, redirects + 1);
  }
  return { res, url };
}

async function handleDownload(req, reply, query) {
  const ip = req.socket.remoteAddress, now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (list.length >= 30) return reply(429, "Слишком много запросов, подождите минуту.");
  list.push(now); hits.set(ip, list);
  try {
    const { res, url } = await open(query.get("url") || "");
    const type = (res.headers["content-type"] || "").split(";")[0].trim();
    const size = Number(res.headers["content-length"] || 0);
    if (res.statusCode !== 200) { res.resume(); return reply(502, "Сайт ответил кодом " + res.statusCode); }
    if (!ALLOWED.test(type)) { res.resume(); return reply(415, "По ссылке не найден фото/видео/аудио файл."); }
    if (size > MAX_BYTES) { res.resume(); return reply(413, "Файл слишком большой."); }
    const name = decodeURIComponent(url.pathname.split("/").pop() || "mediahub-file").replace(/[^\w.\-А-Яа-яЁё ]/g, "_");
    const headers = { "Content-Type": type, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}` };
    if (size) headers["Content-Length"] = size;
    reply.raw.writeHead(200, headers);
    let got = 0;
    res.on("data", c => { got += c.length; if (got > MAX_BYTES) { res.destroy(); reply.raw.destroy(); } });
    res.pipe(reply.raw);
  } catch (e) { reply(400, e.message || "Ошибка загрузки"); }
}

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".md": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8" };
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const reply = (code, msg) => { res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8" }); res.end(msg); };
  reply.raw = res;
  if (u.pathname === "/api/download") return handleDownload(req, reply, u.searchParams);
  const file = path.join(__dirname, u.pathname === "/" ? "index.html" : path.normalize(u.pathname));
  if (!file.startsWith(__dirname) || file.endsWith("server.js")) return reply(403, "Forbidden");
  fs.readFile(file, (err, data) => err ? reply(404, "Not found") :
    (res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" }), res.end(data)));
}).listen(PORT, () => console.log("MediaHub: http://localhost:" + PORT));
