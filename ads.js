// Загрузка рекламы только после выбора в баннере согласия и только если AD_CONFIG заполнен.
(function () {
  const cfg = window.AD_CONFIG || {};
  let consent = null;
  try { consent = localStorage.getItem("mh_consent"); } catch {}

  function loadAds() {
    if (!cfg.client || !/^ca-pub-\d+$/.test(cfg.client)) return;   // нет ID — остаются заглушки
    window.adsbygoogle = window.adsbygoogle || [];
    if (consent !== "granted") window.adsbygoogle.requestNonPersonalizedAds = 1;
    const s = document.createElement("script");
    s.async = true; s.crossOrigin = "anonymous";
    s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + cfg.client;
    document.head.appendChild(s);
    document.querySelectorAll(".ad-slot[data-ad-slot]").forEach((box) => {
      const slot = (cfg.slots || {})[box.dataset.adSlot];
      if (!slot) return;
      box.innerHTML = '<span>РЕКЛАМА</span><ins class="adsbygoogle" style="display:block" data-ad-client="' +
        cfg.client + '" data-ad-slot="' + slot + '" data-ad-format="auto" data-full-width-responsive="true"></ins>';
      window.adsbygoogle.push({});
    });
  }

  function choose(value) {
    consent = value;
    try { localStorage.setItem("mh_consent", value); } catch {}
    banner && banner.remove();
    loadAds();
  }

  let banner = null;
  if (consent) { loadAds(); return; }
  banner = document.createElement("div");
  banner.className = "consent";
  banner.innerHTML = '<p>Мы используем cookie и рекламу Google для показа объявлений. Подробнее — в <a href="privacy.html">политике конфиденциальности</a>.</p>' +
    '<div><button id="cAccept">Принять</button><button id="cDeny" class="ghost">Только необходимое</button></div>';
  document.body.appendChild(banner);
  banner.querySelector("#cAccept").onclick = () => choose("granted");
  banner.querySelector("#cDeny").onclick = () => choose("denied");
})();
