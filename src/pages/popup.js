import { activeNetwork, loadSettings, setActiveNetwork } from "../core/settings.js";
import { nodeStatus, explorerAddressUrl, resolveTarget, shortAddress } from "../core/octra.js";

const els = {
  form: document.getElementById("openForm"),
  input: document.getElementById("openInput"),
  recent: document.getElementById("recentList"),
  recentCount: document.getElementById("recentCount"),
  bookmarkList: document.getElementById("bookmarkList"),
  bookmarkCount: document.getElementById("bookmarkCount"),
  openDashboard: document.getElementById("openDashboard"),
  walletChip: document.getElementById("walletChip"),
  walletName: document.getElementById("walletName"),
  walletAddress: document.getElementById("walletAddress"),
  networkButton: document.getElementById("networkButton"),
  footerNetworkName: document.getElementById("footerNetworkName"),
  networkMenu: document.getElementById("networkMenu"),
  networkList: document.getElementById("networkList"),
  manageNetworks: document.getElementById("manageNetworks")
};

const state = {
  settings: null,
  network: null,
  busy: false,
  networkState: "checking"
};

init().catch(() => {});

async function init() {
  state.settings = await loadSettings();
  state.network = activeNetwork(state.settings);
  renderNetwork();
  renderRecent();
  renderBookmarks();
  bind();
  ping();
  loadWalletInfo();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes["circlet:settings:v1"]) return;
    loadSettings().then((next) => {
      state.settings = next;
      state.network = activeNetwork(next);
      renderNetwork();
      renderRecent();
      renderBookmarks();
    });
  });
}

function bind() {
  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    openInput(els.input.value);
  });
  els.input.focus();

  els.openDashboard.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("home.html") });
    window.close();
  });
  els.walletChip.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("wallets.html") });
    window.close();
  });
  els.networkButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleNetworkMenu();
  });
  els.manageNetworks.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html#networks") });
    window.close();
  });
  els.networkList.addEventListener("click", (event) => {
    const item = event.target.closest?.("[data-network-id]");
    if (item) switchNetwork(item.dataset.networkId);
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest?.(".c-network-wrap")) closeNetworkMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeNetworkMenu();
  });
}

function renderNetwork() {
  const network = state.network;
  els.footerNetworkName.textContent = network.type === "mainnet" || network.type === "devnet" ? network.type : network.name;
  els.networkButton.title = `${network.name} · ${network.type}`;
  els.networkButton.dataset.status = state.networkState;
  els.networkList.replaceChildren();
  for (const item of state.settings.networks) {
    const active = item.id === network.id;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `c-network-menu__item${active ? " is-active" : ""}`;
    button.dataset.networkId = item.id;
    button.setAttribute("role", "menuitemradio");
    button.setAttribute("aria-checked", String(active));
    button.innerHTML = `
      <span class="c-btn-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg></span>
      <span class="c-network-menu__name c-truncate"></span>
      <span class="c-network-menu__type"></span>
      ${active ? '<span class="c-network-menu__check" aria-hidden="true"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></span>' : ""}`;
    button.querySelector(".c-network-menu__name").textContent = item.name;
    button.querySelector(".c-network-menu__type").textContent = item.type;
    els.networkList.append(button);
  }
}

function toggleNetworkMenu() {
  const open = els.networkMenu.hidden;
  els.networkMenu.hidden = !open;
  els.networkButton.setAttribute("aria-expanded", String(open));
  if (open) {
    const active = els.networkList.querySelector(".is-active");
    active?.focus();
  }
}

function closeNetworkMenu() {
  if (els.networkMenu.hidden) return;
  els.networkMenu.hidden = true;
  els.networkButton.setAttribute("aria-expanded", "false");
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

async function switchNetwork(networkId) {
  const target = state.settings.networks.find((network) => network.id === networkId);
  if (!target || target.id === state.network.id) {
    closeNetworkMenu();
    return;
  }
  state.settings = await setActiveNetwork(target.id);
  state.network = activeNetwork(state.settings);
  closeNetworkMenu();
  renderNetwork();
  renderRecent();
  renderBookmarks();
  ping();
}

async function ping() {
  state.networkState = "checking";
  updateNetworkStatusUi();
  try {
    const status = await nodeStatus(state.network);
    state.networkState = status.latencyMs > 1200 ? "warning" : "online";
    updateNetworkStatusUi(status);
  } catch (error) {
    state.networkState = "offline";
    updateNetworkStatusUi(null, error);
  }
}

function updateNetworkStatusUi(status, error) {
  els.networkButton.dataset.status = state.networkState;
  if (error) {
    els.networkButton.title = `${state.network.name} · unreachable`;
  } else if (status) {
    els.networkButton.title = `${state.network.name} · ${status.latencyMs} ms · epoch ${status.epoch ?? "—"}`;
  } else {
    els.networkButton.title = `${state.network.name} · checking`;
  }
}

async function loadWalletInfo() {
  try {
    const peek = await chrome.runtime.sendMessage({ type: "circlet:webcli:peek" });
    if (!peek?.ok || !peek.data?.hasToken) {
      setWalletInfo(null, "No wallet", "Open Wallets");
      return;
    }
    const response = await chrome.runtime.sendMessage({ type: "circlet:webcli:status" });
    if (!response?.ok || !response.data?.wallet?.address) {
      setWalletInfo(null, "Wallet locked", "Open Wallets");
      return;
    }
    const wallet = response.data.wallet;
    const account = response.data.accounts?.accounts?.find((item) => item.active);
    const name = account?.name || "Wallet";
    setWalletInfo(wallet.address, name, shortAddress(wallet.address, 10, 7));
  } catch {
    setWalletInfo(null, "Wallets unavailable", "Open Wallets");
  }
}

function setWalletInfo(address, name, secondary) {
  els.walletName.textContent = name;
  els.walletAddress.textContent = secondary;
  els.walletChip.title = address ? `Open Wallets · ${address}` : "Open Wallets";
  els.walletChip.classList.toggle("has-wallet", Boolean(address));
}

async function openInput(rawInput) {
  const raw = String(rawInput || "").trim();
  if (!raw || state.busy) return;
  state.busy = true;
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
    toast(error?.message || "Unable to resolve destination", "err");
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

function toast(message, kind) {
  try {
    window.SynteqUI?.toast(message, { kind: kind || "info" });
  } catch {}
}
