// Реклама загружается только после явного согласия.
(function () {
  const cfg = window.AD_CONFIG || {};
  let consent = null;
  try { consent = localStorage.getItem("mh_consent"); } catch {}

  function loadAds() {
    if (consent !== "granted" || !cfg.client || !/^ca-pub-\d+$/.test(cfg.client)) return;
    window.adsbygoogle = window.adsbygoogle || [];
    const script = document.createElement("script");
    script.async = true;
    script.crossOrigin = "anonymous";
    script.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(cfg.client);
    document.head.appendChild(script);

    document.querySelectorAll(".ad-slot[data-ad-slot]").forEach((box) => {
      const slot = (cfg.slots || {})[box.dataset.adSlot];
      if (!/^\d+$/.test(String(slot || ""))) return;
      const ad = document.createElement("ins");
      ad.className = "adsbygoogle";
      ad.style.display = "block";
      ad.dataset.adClient = cfg.client;
      ad.dataset.adSlot = slot;
      ad.dataset.adFormat = "auto";
      ad.dataset.fullWidthResponsive = "true";
      box.replaceChildren(ad);
      window.adsbygoogle.push({});
    });
  }

  function choose(value) {
    consent = value;
    try { localStorage.setItem("mh_consent", value); } catch {}
    if (banner) banner.remove();
    loadAds();
  }

  if (consent === "granted") {
    loadAds();
    return;
  }
  if (consent === "denied") return;

  const banner = document.createElement("div");
  banner.className = "consent";
  banner.innerHTML = '<p>Мы используем cookie и рекламу Google только после вашего согласия. Подробнее — в <a href="privacy.html">политике конфиденциальности</a>.</p>' +
    '<div><button type="button" id="cAccept">Принять</button><button type="button" id="cDeny" class="ghost">Только необходимое</button></div>';
  document.body.appendChild(banner);
  banner.querySelector("#cAccept").addEventListener("click", () => choose("granted"));
  banner.querySelector("#cDeny").addEventListener("click", () => choose("denied"));
})();
