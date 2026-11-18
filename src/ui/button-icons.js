const ICONS = {
  action: '<svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>',
  add: '<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
  back: '<svg viewBox="0 0 24 24"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
  check: '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 3v12"/><polyline points="7 10 12 15 17 10"/><path d="M5 21h14"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  expand: '<svg viewBox="0 0 24 24"><polyline points="4 9 4 4 9 4"/><polyline points="20 9 20 4 15 4"/><polyline points="4 15 4 20 9 20"/><polyline points="20 15 20 20 15 20"/></svg>',
  external: '<svg viewBox="0 0 24 24"><path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
  network: '<svg viewBox="0 0 24 24"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>',
  play: '<svg viewBox="0 0 24 24"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16" y2="16"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>',
  upload: '<svg viewBox="0 0 24 24"><path d="M12 21V9"/><polyline points="7 14 12 9 17 14"/><path d="M5 3h14"/></svg>',
  x: '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
};

function iconFor(text) {
  const value = String(text || "").toLowerCase();
  if (/fullscreen|expand/.test(value)) return "expand";
  if (/refresh|retry|reload|switch|retry/.test(value)) return "refresh";
  if (/copy/.test(value)) return "copy";
  if (/import|upload/.test(value)) return "upload";
  if (/download|export/.test(value)) return "download";
  if (/remove|delete|clear|forget|trash/.test(value)) return "trash";
  if (/cancel|close|exit|dismiss/.test(value)) return "x";
  if (/save|done|apply|use|confirm/.test(value)) return "check";
  if (/unlock|passphrase|sealed|lock/.test(value)) return "lock";
  if (/add|new/.test(value)) return "add";
  if (/manage|settings/.test(value)) return "settings";
  if (/explorer|external/.test(value)) return "external";
  if (/sample/.test(value)) return "play";
  if (/resolve|lookup|search/.test(value)) return "search";
  if (/mainnet|devnet|network|chain/.test(value)) return "network";
  if (/home/.test(value)) return "home";
  if (/name|\.oct|ons/.test(value)) return "globe";
  if (/uri|link/.test(value)) return "link";
  if (/edit/.test(value)) return "edit";
  if (/info|details/.test(value)) return "info";
  if (/back/.test(value)) return "back";
  if (/open|go|view|continue|enter|start/.test(value)) return "arrow";
  if (/wallet/.test(value)) return "lock";
  if (/security|privacy|shield/.test(value)) return "lock";
  return "action";
}

function decorate(element) {
  if (!element || element.dataset.circletIcon === "1") return;
  if (element.querySelector("svg")) {
    element.dataset.circletIcon = "1";
    return;
  }
  if (element.classList.contains("sq-iconbtn") || element.classList.contains("sq-theme-toggle") || element.classList.contains("sq-sidebar-toggle")) return;
  const text = element.textContent.replace(/\s+/g, " ").trim();
  if (!text) return;
  const holder = document.createElement("span");
  holder.className = "c-btn-icon";
  holder.setAttribute("aria-hidden", "true");
  holder.innerHTML = ICONS[iconFor(text)] || ICONS.action;
  element.prepend(holder);
  element.dataset.circletIcon = "1";
}

function scan(root) {
  const scope = root && root.querySelectorAll ? root : document;
  scope.querySelectorAll("button, a.sq-btn, label.sq-btn, a.c-chip, .sq-seg__btn").forEach(decorate);
}

scan(document);
new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!node || node.nodeType !== 1) continue;
      if (node.matches?.("button, a.sq-btn, label.sq-btn, a.c-chip, .sq-seg__btn")) decorate(node);
      scan(node);
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true });
