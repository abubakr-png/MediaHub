// MediaHub direct media downloader: images, video, and audio from public direct file URLs.
const $ = (id) => document.getElementById(id);

function validHttpUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function filenameFromUrl(value) {
  try {
    const segment = new URL(value).pathname.split("/").pop();
    const decoded = segment ? decodeURIComponent(segment) : "mediahub-download";
    return decoded.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 150) || "mediahub-download";
  } catch {
    return "mediahub-download";
  }
}

function setStatus(id, message, isError = false) {
  const el = $(id);
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("error", isError);
}

function downloadMedia(value, statusId) {
  const url = value.trim();
  if (!validHttpUrl(url)) {
    setStatus(statusId, "Введи корректную публичную ссылку, начинающуюся с http:// или https://.", true);
    return;
  }

  // Stream through the same-origin server, avoiding CORS and buffering large files in browser memory.
  const link = document.createElement("a");
  link.href = "/api/download?url=" + encodeURIComponent(url);
  link.download = filenameFromUrl(url);
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setStatus(statusId, "Запрос на скачивание отправлен. Работают прямые ссылки на фото, видео и аудио; защищённые ссылки могут не поддерживаться.");
}

function showPreview(boxId, value) {
  const box = $(boxId);
  if (!box || !validHttpUrl(value)) return;
  const url = new URL(value);
  const ext = url.pathname.split(".").pop().toLowerCase();
  const audioExt = ["mp3", "wav", "ogg", "m4a", "flac", "aac", "opus"];
  const imageExt = ["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp"];
  const isImage = imageExt.includes(ext);
  const el = document.createElement(audioExt.includes(ext) ? "audio" : isImage ? "img" : "video");
  el.src = value;
  el.className = isImage ? "preview image-preview" : "preview";
  if (el.tagName !== "IMG") {
    el.controls = true;
    el.preload = "metadata";
  }
  el.onerror = () => setStatus("mediaStatus", "Не удалось показать превью. Попробуй скачать файл по прямой ссылке.", true);
  box.replaceChildren(el);
}

$("imageBtn")?.addEventListener("click", () => downloadMedia($("imageUrl").value, "imageStatus"));
$("mediaBtn")?.addEventListener("click", () => {
  const url = $("mediaUrl").value.trim();
  if (!validHttpUrl(url)) {
    setStatus("mediaStatus", "Введи корректную ссылку на прямой медиафайл.", true);
    return;
  }
  showPreview("mediaPreview", url);
  downloadMedia(url, "mediaStatus");
});

$("spotifyBtn")?.addEventListener("click", () => {
  const value = $("spotifyUrl").value.trim();
  let parsed;
  try { parsed = new URL(value); } catch {}
  const match = parsed && parsed.protocol === "https:" && parsed.hostname === "open.spotify.com"
    ? parsed.pathname.match(/\/(?:intl-[a-z]+\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/)
    : null;

  if (!match) {
    setStatus("spotifyStatus", "Вставь корректную ссылку Spotify, например https://open.spotify.com/track/…", true);
    return;
  }

  const player = $("spotifyPlayer");
  const frame = document.createElement("iframe");
  frame.src = `https://open.spotify.com/embed/${match[1]}/${match[2]}`;
  frame.allow = "encrypted-media; clipboard-write";
  frame.loading = "lazy";
  frame.className = "spotify-frame";
  frame.title = "Spotify-плеер";
  player.replaceChildren(frame);
  setStatus("spotifyStatus", "Для офлайн-прослушивания используй официальную функцию загрузки Spotify Premium.");
});

$("socialBtn")?.addEventListener("click", () => {
  const value = $("socialUrl").value.trim();
  if (!validHttpUrl(value)) {
    setStatus("socialStatus", "Введи корректную ссылку на публикацию.", true);
    return;
  }
  window.open(value, "_blank", "noopener,noreferrer");
  setStatus("socialStatus", "Оригинальная публикация открыта в новой вкладке.");
});

const year = $("year");
if (year) year.textContent = new Date().getFullYear();
