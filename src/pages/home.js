import {
  activeNetwork,
  addRecent,
  deleteBookmark,
  loadSettings,
  normalizeSettings,
  removeRecent,
  saveBookmark,
  setActiveNetwork
} from "../core/settings.js";
import {
  explorerAddressUrl,
  nodeStatus,
  resolveTarget,
  shortAddress
} from "../core/octra.js";

const els = {
  openForm: document.getElementById("openForm"),
  openInput: document.getElementById("openInput"),
  recentList: document.getElementById("recentList"),
  recentCount: document.getElementById("recentCount"),
  bookmarkForm: document.getElementById("bookmarkForm"),
  bookmarkInput: document.getElementById("bookmarkInput"),
  bookmarkList: document.getElementById("bookmarkList"),
  bookmarkCount: document.getElementById("bookmarkCount"),
  topDot: document.getElementById("topDot"),
  topStatusText: document.getElementById("topStatusText"),
  dockDot: document.getElementById("dockDot"),
  dockNetwork: document.getElementById("dockNetwork"),
  networkMeta: document.getElementById("networkMeta"),
  statNetwork: document.getElementById("statNetwork"),
  statEpoch: document.getElementById("statEpoch"),
  statLatency: document.getElementById("statLatency"),
  statVersion: document.getElementById("statVersion"),
  networkSeg: document.getElementById("networkSeg"),
  networkKv: document.getElementById("networkKv"),
  latencySpark: document.getElementById("latencySpark"),
  networkHint: document.getElementById("networkHint"),
  refreshStatus: document.getElementById("refreshStatus"),
  nameForm: document.getElementById("nameForm"),
  nameInput: document.getElementById("nameInput"),
  nameResult: document.getElementById("nameResult"),
  remotePolicy: document.getElementById("remotePolicy")
};

const state = {
  settings: null,
  network: null,
  lastTarget: null,
  busy: false,
  bookmarkBusy: false
};

init().catch((error) => {
  toast(error?.message || "Unable to load circlet.", "err");
});

async function init() {
  state.settings = await loadSettings();
  state.network = activeNetwork(state.settings);
  bind();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes["circlet:settings:v1"]) return;
    const next = normalizeSettings(changes["circlet:settings:v1"].newValue);
    const networkChanged = next.activeNetworkId !== state.network?.id;
    state.settings = next;
    state.network = activeNetwork(next);
    if (networkChanged) {
      renderNetwork();
      refreshStatus();
    }
    renderRecent();
    renderBookmarks();
  });
  renderNetwork();
  renderRecent();
  renderBookmarks();
  refreshStatus();
}

function bind() {
  els.openForm.addEventListener("submit", (event) => {
    event.preventDefault();
    openInput(els.openInput.value);
  });
  els.nameForm.addEventListener("submit", (event) => {
    event.preventDefault();
    lookupName(els.nameInput.value);
  });
  els.bookmarkForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveBookmarkInput(els.bookmarkInput.value);
  });
  els.refreshStatus.addEventListener("click", refreshStatus);
  document.addEventListener("click", (event) => {
    const sample = event.target.closest?.("[data-open]");
    if (sample) {
      openRecent({
        circleId: sample.dataset.open,
        path: "/index.html",
        display: `oct://${sample.dataset.open}`,
        networkId: sample.dataset.net || state.network.id
      });
      return;
    }
    const fill = event.target.closest?.("[data-fill]");
    if (fill) {
      els.openInput.value = fill.dataset.fill;
      els.openInput.focus();
      return;
    }
    const net = event.target.closest?.("#networkSeg [data-network]");
    if (net) {
      switchNetwork(net.dataset.network);
      return;
    }
    const remove = event.target.closest?.("[data-remove-recent]");
    if (remove) {
      const { circleId, path, networkId } = remove.dataset;
      removeRecent(circleId, path, networkId).then((settings) => {
        state.settings = settings;
        renderRecent();
        toast("Removed from recent Circles", "ok");
      });
    }
  });
}

function toast(message, kind) {
  try {
    window.SynteqUI?.toast(message, { kind: kind || "info" });
  } catch {}
}

function setLoading(active) {
  try {
    window.SynteqUI?.setLoading(Boolean(active));
  } catch {}
}

function renderNetwork() {
  const network = state.network;
  document.title = `circlet — ${network.name}`;
  els.dockNetwork.textContent = network.name;
  els.statNetwork.textContent = network.name;
  els.networkMeta.textContent = `${network.type} · ${network.rpcUrls.length} endpoint${network.rpcUrls.length === 1 ? "" : "s"}`;
  els.remotePolicy.textContent = state.settings.allowRemoteNetwork ? "inline + optional runtime HTTPS" : "disabled";

  els.networkSeg.replaceChildren();
  for (const candidate of state.settings.networks) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `sq-seg__btn${candidate.id === network.id ? " sq-seg__btn--active" : ""}`;
    button.dataset.network = candidate.id;
    button.setAttribute("aria-pressed", String(candidate.id === network.id));
    button.textContent = candidate.id === "local"
      ? "Local"
      : candidate.type === "mainnet"
        ? "Mainnet"
        : candidate.type === "devnet"
          ? "Devnet"
          : candidate.name;
    els.networkSeg.append(button);
  }

  els.networkKv.replaceChildren(
    kv("RPC", network.rpcUrls.join(" → "), true),
    kv("Explorer", network.explorer || "not configured", true),
    kv("Name service", network.identity || "not configured", true),
    kv("Remote assets", state.settings.allowRemoteNetwork ? "allowed for public Circles" : "blocked")
  );
  els.networkHint.textContent = `RPC fallback is automatic: ${network.rpcUrls.length} endpoint${network.rpcUrls.length === 1 ? "" : "s"} in order.`;
  els.statLatency.textContent = "—";
  els.statEpoch.textContent = "—";
  els.statVersion.textContent = network.chainId || "—";
  els.statVersion.title = "";
}

async function refreshStatus() {
  const network = state.network;
  setLoading(true);
  els.topStatusText.textContent = "checking";
  els.topDot.style.background = "var(--sq-status-warning)";
  try {
    const status = await nodeStatus(network);
    if (network.id !== state.network.id) return;
    els.topStatusText.textContent = "online";
    els.topDot.style.background = "var(--sq-status-running)";
    els.dockDot.style.background = "var(--sq-status-running)";
    els.statEpoch.textContent = String(status.epoch ?? "—");
    els.statLatency.textContent = `${status.latencyMs} ms`;
    els.statVersion.textContent = String(status.chainId || state.network.chainId || "—");
    els.statVersion.title = status.nodeVersion ? `Node ${status.nodeVersion}` : "";
    recordLatency(status.latencyMs);
  } catch (error) {
    if (network.id !== state.network.id) return;
    els.topStatusText.textContent = "offline";
    els.topDot.style.background = "var(--sq-status-error)";
    els.dockDot.style.background = "var(--sq-status-error)";
    els.statLatency.textContent = "unreachable";
    els.statVersion.textContent = state.network.chainId || "—";
    els.networkHint.textContent = error?.message || "RPC is unreachable.";
  } finally {
    setLoading(false);
  }
}

function latencyKey() {
  return `circlet:latency:${state.network.id}`;
}

function recordLatency(value) {
  const latency = Number(value);
  if (!Number.isFinite(latency)) return;
  let values = [];
  try {
    values = JSON.parse(sessionStorage.getItem(latencyKey()) || "[]");
  } catch {
    values = [];
  }
  if (!Array.isArray(values)) values = [];
  values.push(latency);
  values = values.slice(-16);
  try {
    sessionStorage.setItem(latencyKey(), JSON.stringify(values));
  } catch {}
  try {
    window.SynteqUI?.renderSparkline(els.latencySpark, values);
  } catch {}
}

async function switchNetwork(idOrType) {
  const target = state.settings.networks.find((network) => network.id === idOrType || network.type === idOrType);
  if (!target || target.id === state.network.id) return;
  state.settings = await setActiveNetwork(target.id);
  state.network = activeNetwork(state.settings);
  renderNetwork();
  renderRecent();
  renderBookmarks();
  sessionStorage.removeItem(latencyKey());
  refreshStatus();
}

function renderRecent() {
  els.recentList.replaceChildren();
  const recent = state.settings.recent.slice(0, 8);
  els.recentCount.textContent = String(state.settings.recent.length);
  if (!recent.length) {
    const empty = document.createElement("div");
    empty.className = "c-empty-mini";
    empty.textContent = "No Circles yet. Open one above or from the address bar.";
    els.recentList.append(empty);
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
    title.textContent = entry.title || entry.display || shortAddress(entry.circleId);
    const meta = document.createElement("span");
    meta.className = "c-list__meta c-mono c-truncate";
    const network = state.settings.networks.find((item) => item.id === entry.networkId);
    meta.textContent = `${entry.display || entry.circleId} · ${network?.name || entry.networkId}`;
    copy.append(title, meta);
    const actions = document.createElement("div");
    actions.className = "c-recent-actions";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "sq-btn sq-btn--ghost";
    open.textContent = "Open";
    open.addEventListener("click", () => openRecent(entry));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "sq-btn sq-iconbtn";
    remove.dataset.removeRecent = "1";
    remove.dataset.circleId = entry.circleId;
    remove.dataset.path = entry.path;
    remove.dataset.networkId = entry.networkId;
    remove.setAttribute("aria-label", `Remove ${entry.title || entry.circleId}`);
    remove.innerHTML = '<svg class="sq-icon sq-icon--14" viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    actions.append(open, remove);
    row.append(copy, actions);
    els.recentList.append(row);
  }
}

function openRecent(entry) {
  const params = new URLSearchParams({
    circleId: entry.circleId,
    path: entry.path || "/index.html",
    display: entry.display || `oct://${entry.circleId}`,
    net: entry.networkId || state.network.id
  });
  if (entry.mode) params.set("mode", entry.mode);
  location.assign(`viewer.html?${params.toString()}`);
}

function renderBookmarks() {
  els.bookmarkList.replaceChildren();
  const bookmarks = state.settings.bookmarks || [];
  els.bookmarkCount.textContent = String(bookmarks.length);
  if (!bookmarks.length) {
    const empty = document.createElement("div");
    empty.className = "c-empty-mini";
    empty.textContent = "No bookmarks yet. Save a Circle, account address, or website above.";
    els.bookmarkList.append(empty);
    return;
  }
  for (const entry of bookmarks) {
    const network = state.settings.networks.find((item) => item.id === entry.networkId);
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
    meta.textContent = `${entry.kind}${network ? ` · ${network.name}` : ""} · ${entry.display || entry.url}`;
    copy.append(title, meta);
    const actions = document.createElement("div");
    actions.className = "c-recent-actions";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "sq-btn sq-btn--ghost";
    open.textContent = "Open";
    open.addEventListener("click", () => openBookmark(entry));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "sq-btn sq-btn--ghost";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      state.settings = await deleteBookmark(entry.id);
      renderBookmarks();
      toast("Bookmark removed", "ok");
    });
    actions.append(open, remove);
    row.append(copy, actions);
    els.bookmarkList.append(row);
  }
}

async function openBookmark(entry) {
  if (entry.kind === "circle") {
    openRecent({
      circleId: entry.circleId,
      path: entry.path,
      display: entry.display,
      networkId: entry.networkId,
      mode: entry.mode
    });
    return;
  }
  if (entry.kind === "account") {
    const network = state.settings.networks.find((item) => item.id === entry.networkId);
    const url = explorerAddressUrl(network?.explorer, entry.address);
    if (!url) return toast("No explorer is configured for this account's network.", "warn");
    await chrome.tabs.create({ url });
    return;
  }
  if (entry.kind === "web" && /^https?:\/\//i.test(entry.url || "")) {
    await chrome.tabs.create({ url: entry.url });
  }
}

async function saveBookmarkInput(rawInput) {
  const raw = String(rawInput || "").trim();
  if (!raw || state.bookmarkBusy) return;
  state.bookmarkBusy = true;
  setLoading(true);
  try {
    let entry;
    if (/^https?:\/\//i.test(raw)) {
      const url = new URL(raw);
      entry = { kind: "web", url: url.href, title: url.hostname };
    } else {
      const target = await resolveTarget(raw, state.settings, { network: state.network });
      if (target.kind === "web") {
        entry = { kind: "web", url: target.url, title: target.title };
      } else if (target.kind === "account") {
        entry = {
          kind: "account",
          address: target.address,
          display: target.address,
          title: target.name || shortAddress(target.address),
          networkId: state.network.id
        };
      } else {
        entry = {
          kind: "circle",
          circleId: target.circleId,
          host: target.host,
          path: target.path,
          display: target.display,
          title: target.name || shortAddress(target.circleId),
          networkId: state.network.id,
          mode: target.mode
        };
      }
    }
    state.settings = await saveBookmark(entry);
    renderBookmarks();
    els.bookmarkInput.value = "";
    toast("Bookmark saved", "ok");
  } catch (error) {
    toast(error?.message || "Unable to save bookmark", "err");
  } finally {
    state.bookmarkBusy = false;
    setLoading(false);
  }
}

async function openInput(rawInput) {
  const raw = String(rawInput || "").trim();
  if (!raw || state.busy) return;
  state.busy = true;
  setLoading(true);
  try {
    if (/^https?:\/\//i.test(raw)) {
      await chrome.tabs.create({ url: raw });
      return;
    }
    const target = await resolveTarget(raw, state.settings, { network: state.network });
    if (target.kind === "web") {
      await chrome.tabs.create({ url: target.url });
      return;
    }
    if (target.kind === "account") {
      if (target.explorerUrl) await chrome.tabs.create({ url: target.explorerUrl });
      toast("This address is not a Circle. Opened in the explorer.", "warn");
      return;
    }
    await addRecent({
      circleId: target.circleId,
      path: target.path,
      display: target.display,
      title: target.name || shortAddress(target.circleId),
      networkId: state.network.id,
      mode: target.mode
    });
    const params = new URLSearchParams({
      circleId: target.circleId,
      path: target.path,
      display: target.display,
      mode: target.mode,
      net: state.network.id
    });
    location.assign(`viewer.html?${params.toString()}`);
  } catch (error) {
    toast(error?.message || "Unable to resolve destination", "err");
  } finally {
    state.busy = false;
    setLoading(false);
  }
}

async function lookupName(rawInput) {
  let value = String(rawInput || "").trim().toLowerCase();
  if (!value) return;
  value = value.replace(/^oct:\/\//i, "").split("/")[0];
  if (!value.endsWith(".oct") && /^[a-z0-9-]+(\.[a-z0-9-]+)?$/.test(value)) value = `${value}.oct`;
  els.nameInput.value = value;
  state.busy = true;
  setLoading(true);
  renderNamePending(value);
  try {
    const target = await resolveTarget(value, state.settings, { network: state.network });
    if (target.kind === "web") throw new Error("Enter an Octra Name Service name such as name.oct.");
    state.lastTarget = target;
    renderNameTarget(value, target);
  } catch (error) {
    state.lastTarget = null;
    renderNameError(error?.message || "Unable to resolve name");
  } finally {
    state.busy = false;
    setLoading(false);
  }
}

function renderNamePending(name) {
  els.nameResult.replaceChildren();
  const row = document.createElement("div");
  row.className = "c-status-line";
  row.innerHTML = '<span class="sq-spinner sq-spinner--sm" role="status" aria-label="Resolving"></span>';
  const text = document.createElement("span");
  text.textContent = `Resolving ${name} on ${state.network.name}…`;
  row.append(text);
  els.nameResult.append(row);
}

function renderNameError(message) {
  els.nameResult.replaceChildren();
  const row = document.createElement("div");
  row.className = "c-status-line c-error-text";
  row.textContent = message;
  els.nameResult.append(row);
}

function renderNameTarget(name, target) {
  els.nameResult.replaceChildren();
  const address = target.address || target.circleId;
  const kvBox = document.createElement("div");
  kvBox.className = "sq-kv";
  kvBox.append(
    kv("Name", name),
    kv("Address", address, true),
    kv("Kind", target.kind === "circle" ? `Circle · ${target.mode}` : "Regular account", false)
  );
  els.nameResult.append(kvBox);
  const actions = document.createElement("div");
  actions.className = "c-actions";
  if (target.kind === "circle") {
    const open = document.createElement("button");
    open.type = "button";
    open.className = "sq-btn sq-btn--brand";
    open.textContent = "Open Circle";
    open.addEventListener("click", () => {
      const params = new URLSearchParams({
        circleId: target.circleId,
        path: target.path,
        display: target.display,
        mode: target.mode,
        net: state.network.id
      });
      addRecent({
        circleId: target.circleId,
        path: target.path,
        display: target.display,
        title: name,
        networkId: state.network.id,
        mode: target.mode
      });
      location.assign(`viewer.html?${params.toString()}`);
    });
    actions.append(open);
  }
  if (target.explorerUrl) {
    const explorer = document.createElement("a");
    explorer.className = "sq-btn sq-btn--ghost";
    explorer.href = target.explorerUrl;
    explorer.target = "_blank";
    explorer.rel = "noopener noreferrer";
    explorer.textContent = "Explorer";
    actions.append(explorer);
  }
  els.nameResult.append(actions);
}

function kv(label, value, mono) {
  const row = document.createElement("div");
  row.className = "sq-kv__row";
  const key = document.createElement("span");
  key.className = "sq-kv__label";
  key.textContent = label;
  const val = document.createElement("span");
  val.className = `sq-kv__value c-break${mono ? " sq-mono" : ""}`;
  val.textContent = String(value || "—");
  row.append(key, val);
  return row;
}
