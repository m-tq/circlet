import { activeNetwork, loadSettings, setActiveNetwork } from "../core/settings.js";
import { nodeStatus, explorerAddressUrl, resolveTarget, shortAddress } from "../core/octra.js";

const els = {
  form: document.getElementById("openForm"),
  input: document.getElementById("openInput"),
  recent: document.getElementById("recentList"),
  recentCount: document.getElementById("recentCount"),
  bookmarkList: document.getElementById("bookmarkList"),
  bookmarkCount: document.getElementById("bookmarkCount"),
  netDot: document.getElementById("netDot"),
  netName: document.getElementById("netName"),
  netMeta: document.getElementById("netMeta"),
  networkSeg: document.getElementById("networkSeg"),
  statusHint: document.getElementById("statusHint")
};

const state = { settings: null, network: null, busy: false };

init().catch(() => {});

async function init() {
  state.settings = await loadSettings();
  state.network = activeNetwork(state.settings);
  renderNetwork();
  renderRecent();
  renderBookmarks();
  bind();
  ping();
}

function bind() {
  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    openInput(els.input.value);
  });
  els.input.focus();
  document.addEventListener("click", (event) => {
    const net = event.target.closest?.("#networkSeg [data-network]");
    if (net) {
      switchNetwork(net.dataset.network);
      return;
    }
    if (event.target.closest?.("[data-open-sample]")) {
      openViewer({
        circleId: "oct3A5bhpktxb9y2gepQeGxSbkJspq3Pv178Zyi9tkM1oJx",
        path: "/index.html",
        display: "oct://oct3A5bhpktxb9y2gepQeGxSbkJspq3Pv178Zyi9tkM1oJx",
        networkId: "devnet"
      });
    }
  });
}

function renderNetwork() {
  const network = state.network;
  els.netName.textContent = network.name;
  els.netMeta.textContent = network.type;
  els.networkSeg.querySelectorAll("[data-network]").forEach((button) => {
    const candidate = state.settings.networks.find((item) => item.type === button.dataset.network);
    const active = Boolean(candidate && candidate.id === network.id);
    button.classList.toggle("sq-seg__btn--active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function renderRecent() {
  els.recent.replaceChildren();
  const recent = state.settings.recent.slice(0, 5);
  els.recentCount.textContent = String(state.settings.recent.length);
  if (!recent.length) {
    const empty = document.createElement("div");
    empty.className = "c-popup__empty";
    empty.textContent = "No recent Circles yet.";
    els.recent.append(empty);
    return;
  }
  for (const entry of recent) {
    const row = document.createElement("div");
    row.className = "c-list__row";
    const copy = document.createElement("div");
    copy.className = "c-col";
    copy.style.gap = "2px";
    const title = document.createElement("span");
    title.className = "c-list__title c-truncate";
    title.textContent = entry.title || shortAddress(entry.circleId);
    const meta = document.createElement("span");
    meta.className = "c-list__meta c-mono c-truncate";
    meta.textContent = entry.display || entry.circleId;
    copy.append(title, meta);
    const open = document.createElement("button");
    open.type = "button";
    open.className = "sq-btn sq-btn--ghost";
    open.textContent = "Open";
    open.addEventListener("click", () => openViewer(entry));
    row.append(copy, open);
    els.recent.append(row);
  }
}

function renderBookmarks() {
  els.bookmarkList.replaceChildren();
  const bookmarks = state.settings.bookmarks || [];
  els.bookmarkCount.textContent = String(bookmarks.length);
  if (!bookmarks.length) {
    const empty = document.createElement("div");
    empty.className = "c-popup__empty";
    empty.textContent = "No saved destinations yet.";
    els.bookmarkList.append(empty);
    return;
  }
  for (const entry of bookmarks.slice(0, 4)) {
    const row = document.createElement("div");
    row.className = "c-list__row";
    const copy = document.createElement("div");
    copy.className = "c-col";
    copy.style.gap = "2px";
    const title = document.createElement("span");
    title.className = "c-list__title c-truncate";
    title.textContent = entry.title || entry.display || entry.url || shortAddress(entry.circleId || entry.address);
    const meta = document.createElement("span");
    meta.className = "c-list__meta c-mono c-truncate";
    meta.textContent = `${entry.kind} · ${entry.display || entry.url}`;
    copy.append(title, meta);
    const open = document.createElement("button");
    open.type = "button";
    open.className = "sq-btn sq-btn--ghost";
    open.textContent = "Open";
    open.addEventListener("click", () => openBookmark(entry));
    row.append(copy, open);
    els.bookmarkList.append(row);
  }
}

function openBookmark(entry) {
  if (entry.kind === "circle") {
    openViewer({
      circleId: entry.circleId,
      path: entry.path,
      display: entry.display,
      mode: entry.mode,
      networkId: entry.networkId
    });
    return;
  }
  if (entry.kind === "account") {
    const network = state.settings.networks.find((item) => item.id === entry.networkId);
    const url = explorerAddressUrl(network?.explorer, entry.address);
    if (url) chrome.tabs.create({ url });
    window.close();
    return;
  }
  if (entry.kind === "web" && /^https?:\/\//i.test(entry.url || "")) {
    chrome.tabs.create({ url: entry.url });
    window.close();
  }
}

async function switchNetwork(type) {
  const target = state.settings.networks.find((network) => network.type === type);
  if (!target || target.id === state.network.id) return;
  state.settings = await setActiveNetwork(target.id);
  state.network = activeNetwork(state.settings);
  renderNetwork();
  renderRecent();
  renderBookmarks();
  ping();
}

async function ping() {
  els.netDot.style.background = "var(--sq-status-warning)";
  els.statusHint.textContent = "Checking RPC…";
  try {
    const status = await nodeStatus(state.network);
    if (status.latencyMs > 1200) els.netDot.style.background = "var(--sq-status-warning)";
    else els.netDot.style.background = "var(--sq-status-running)";
    els.statusHint.textContent = `${state.network.rpcUrls[0]} · ${status.latencyMs} ms · epoch ${status.epoch ?? "—"}`;
  } catch (error) {
    els.netDot.style.background = "var(--sq-status-error)";
    els.statusHint.textContent = error?.message || "RPC unreachable";
  }
}

async function openInput(rawInput) {
  const raw = String(rawInput || "").trim();
  if (!raw || state.busy) return;
  state.busy = true;
  els.statusHint.textContent = "Resolving…";
  try {
    if (/^https?:\/\//i.test(raw)) {
      await chrome.tabs.create({ url: raw });
      window.close();
      return;
    }
    const target = await resolveTarget(raw, state.settings, { network: state.network });
    if (target.kind === "web") {
      await chrome.tabs.create({ url: target.url });
    } else if (target.kind === "account") {
      await chrome.tabs.create({ url: target.explorerUrl });
    } else {
      openViewer({
        circleId: target.circleId,
        path: target.path,
        display: target.display,
        mode: target.mode,
        networkId: state.network.id
      });
    }
    window.close();
  } catch (error) {
    els.statusHint.textContent = error?.message || "Unable to resolve destination";
  } finally {
    state.busy = false;
  }
}

function openViewer(entry) {
  const params = new URLSearchParams({
    circleId: entry.circleId,
    path: entry.path || "/index.html",
    display: entry.display || `oct://${entry.circleId}`,
    net: entry.networkId || state.network.id
  });
  if (entry.mode) params.set("mode", entry.mode);
  chrome.tabs.create({ url: chrome.runtime.getURL(`viewer.html?${params.toString()}`) });
  window.close();
}
