(() => {
  "use strict";

  function linkDestination(value) {
    const raw = String(value || "").trim();
    if (!raw || raw === "#") return null;
    if (raw.toLowerCase().startsWith("oct://")) return raw;
    if (/^(?:[a-z0-9]+(?:-[a-z0-9]+)*\.){1,2}oct(?:[/?#]|$)/i.test(raw)) return raw;
    try {
      const url = new URL(raw, document.baseURI);
      if (!/^https?:$/.test(url.protocol)) return null;
      if (!url.hostname.toLowerCase().endsWith(".oct")) return null;
      return `${url.hostname}${url.pathname}${url.search}${url.hash}`;
    } catch {
      return null;
    }
  }

  function handle(event) {
    const link = event.target?.closest?.("a[href]");
    if (!link || link.hasAttribute("download")) return;
    const input = linkDestination(link.getAttribute("href") || "");
    if (!input) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const disposition = link.target === "_blank" || event.shiftKey
      ? "newForegroundTab"
      : event.button === 1 || event.ctrlKey || event.metaKey
        ? "newBackgroundTab"
        : "currentTab";
    try {
      chrome.runtime.sendMessage({ type: "open-circlet-input", input, disposition });
    } catch {
      // The extension context can be invalidated after an update; ignore.
    }
  }

  document.addEventListener("click", handle, true);
  document.addEventListener("auxclick", handle, true);
})();
