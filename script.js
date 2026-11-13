const $ = (id) => document.getElementById(id);
const toast = $("toast");
let toastTimer;
function notify(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}
function validHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch { return false; }
}
function filenameFromUrl(url) {
  try {
    const name = new URL(url).pathname.split("/").pop();
    return name || "mediahub-download";
  } catch { return "mediahub-download"; }
}
const hasServer = location.protocol.startsWith("http");
function saveBlobOrLink(href, name) {
  const link = document.createElement("a");
  link.href = href; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
}
async function downloadDirect(url, statusId) {
  const status = $(statusId);
  if (!validHttpUrl(url)) { status.textContent = "Введи корректную ссылку, начинающуюся с http:// или https://."; return; }
  status.textContent = "Скачиваем…";
  const name = filenameFromUrl(url);
  try {   // 1) напрямую из браузера
    const response = await fetch(url);
    if (!response.ok) throw new Error("HTTP " + response.status);
    const blob = await response.blob();
    if (!/^(image|video|audio)\//.test(blob.type)) throw new Error("not media");
    const objectUrl = URL.createObjectURL(blob);
    saveBlobOrLink(objectUrl, name);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
    status.textContent = "Готово! Файл сохранён.";
    return;
  } catch {}
  if (!hasServer) { status.textContent = "Сайт блокирует прямой доступ (CORS). Запусти проект через node server.js — тогда загрузка пойдёт через сервер."; return; }
  try {   // 2) через сервер MediaHub (обход CORS)
    const proxied = "/api/download?url=" + encodeURIComponent(url);
    const check = await fetch(proxied, { method: "GET", headers: { Range: "bytes=0-0" } });
    if (!check.ok) throw new Error(await check.text());
    check.body && check.body.cancel();
    saveBlobOrLink(proxied, name);
    status.textContent = "Готово! Загрузка началась через сервер.";
  } catch (e) { status.textContent = "Не удалось скачать: " + (e.message || "ссылка не ведёт на медиафайл."); }
}
function showPreview(boxId, url) {
  const box = $(boxId); box.innerHTML = "";
  const ext = (new URL(url).pathname.split(".").pop() || "").toLowerCase();
  const isAudio = ["mp3", "wav", "ogg", "m4a", "flac", "aac"].includes(ext);
  const el = document.createElement(isAudio ? "audio" : "video");
  el.src = url; el.controls = true; el.preload = "metadata"; el.className = "preview";
  box.appendChild(el);
}
$("imageBtn").addEventListener("click", () => downloadDirect($("imageUrl").value.trim(), "imageStatus"));
$("mediaBtn").addEventListener("click", () => {
  const url = $("mediaUrl").value.trim();
  if (validHttpUrl(url)) showPreview("mediaPreview", url);
  downloadDirect(url, "mediaStatus");
});
$("spotifyBtn").addEventListener("click", () => {
  const url = $("spotifyUrl").value.trim();
  const m = validHttpUrl(url) && new URL(url).hostname === "open.spotify.com" &&
    new URL(url).pathname.match(/\/(?:intl-[a-z]+\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/);
  if (!m) { $("spotifyStatus").textContent = "Вставь ссылку вида https://open.spotify.com/track/..."; return; }
  const box = $("spotifyPlayer"); box.innerHTML = "";
  const frame = document.createElement("iframe");
  frame.src = `https://open.spotify.com/embed/${m[1]}/${m[2]}`;
  frame.allow = "encrypted-media; clipboard-write"; frame.loading = "lazy";
  frame.className = "spotify-frame"; frame.title = "Spotify";
  box.appendChild(frame);
  $("spotifyStatus").innerHTML = 'Слушай прямо здесь или <a href="' + new URL(url).origin + new URL(url).pathname + '" target="_blank" rel="noopener noreferrer">открой в Spotify</a>. Для офлайн-прослушивания используй функцию «Скачать» в приложении Spotify Premium.';
});
$("socialBtn").addEventListener("click", () => {
  const url = $("socialUrl").value.trim();
  if (!validHttpUrl(url)) { $("socialStatus").textContent = "Введи корректную ссылку на публикацию."; return; }
  window.open(url, "_blank", "noopener,noreferrer");
  $("socialStatus").textContent = "Оригинальная публикация открыта в новой вкладке.";
});
$("year").textContent = new Date().getFullYear();
