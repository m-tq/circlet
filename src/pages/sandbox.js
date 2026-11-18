(() => {
  "use strict";

  let token = "";
  let titleTimer = null;

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.source !== "circlet-render") return;
    token = String(message.token || "");
    const html = typeof message.html === "string" && message.html
      ? message.html
      : "<!doctype html><title>circlet</title>";
    document.open();
    document.write(html);
    document.close();
    startTitleReporting();
    try {
      window.parent.postMessage({ source: "circlet-frame", type: "ready", token }, "*");
    } catch {}
  });

  function currentFavicon() {
    const nodes = [...document.querySelectorAll('link[rel][href]')];
    const icon = nodes.find((node) => /(?:^|\s)(?:icon|shortcut|apple-touch-icon)(?:\s|$)/i.test(node.getAttribute("rel") || ""));
    const href = icon?.getAttribute("href") || "";
    if (!/^(?:data:|https?:|blob:)/i.test(href)) return "";
    return href.slice(0, 1_500_000);
  }

  function report() {
    if (!token) return;
    try {
      window.parent.postMessage({
        source: "circlet-frame",
        type: "meta",
        token,
        title: String(document.title || "").slice(0, 160),
        favicon: currentFavicon()
      }, "*");
    } catch {}
  }

  function startTitleReporting() {
    if (titleTimer) clearInterval(titleTimer);
    let lastTitle = null;
    let lastFavicon = null;
    const tick = () => {
      const nextTitle = String(document.title || "");
      const nextFavicon = currentFavicon();
      if (nextTitle === lastTitle && nextFavicon === lastFavicon) return;
      lastTitle = nextTitle;
      lastFavicon = nextFavicon;
      report();
    };
    titleTimer = setInterval(tick, 700);
    setTimeout(tick, 60);
    setTimeout(tick, 400);
  }
})();
