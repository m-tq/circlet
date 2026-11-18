const SETTINGS_KEY = "circlet:settings:v1";
const RECENT_LIMIT = 14;
const BOOKMARK_LIMIT = 200;

export const IDENTITY_MAINNET = "octH1GEiwunjEZyiBMjp1ETy1VUJJKEEnsMRZ8P2AvTC3et";
export const IDENTITY_DEVNET = "oct2Tdnmgh8qtvhC82W9VhoRJcLkAhNRCbnEEPhCUPX5b7m";

export const DEFAULT_NETWORKS = [
  {
    id: "mainnet",
    name: "Octra Mainnet",
    type: "mainnet",
    rpcUrls: ["https://octra.network/rpc"],
    explorer: "https://octrascan.io",
    identity: IDENTITY_MAINNET,
    isDefault: true
  },
  {
    id: "devnet",
    name: "Octra Devnet",
    type: "devnet",
    rpcUrls: ["https://devnet.octrascan.io/rpc"],
    explorer: "https://devnet.octrascan.io",
    identity: IDENTITY_DEVNET,
    chainId: "octra-devnet-9871-cluster",
    isDefault: true
  }
];

export const DEFAULT_SETTINGS = {
  activeNetworkId: "devnet",
  networks: DEFAULT_NETWORKS,
  allowRemoteNetwork: true,
  showProtocolBar: true,
  recent: [],
  bookmarks: []
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeNetworkType(value) {
  const type = String(value || "").trim().toLowerCase();
  return type === "mainnet" || type === "devnet" ? type : "custom";
}

function normalizeEndpoint(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.href.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function normalizeNetwork(input, fallbackIndex = 0) {
  if (!input || typeof input !== "object") return null;
  const rawEndpoints = Array.isArray(input.rpcUrls)
    ? input.rpcUrls
    : String(input.rpcUrl || "").split(/[\n,]+/);
  const rpcUrls = [...new Set(rawEndpoints.map(normalizeEndpoint).filter(Boolean))];
  const explorer = normalizeEndpoint(input.explorer);
  const identity = String(input.identity || input.identityProvider || "").trim();
  const name = String(input.name || "").trim();
  if (!name || !rpcUrls.length) return null;
  const id = String(input.id || `${safeNetworkType(input.type)}-${fallbackIndex}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`).trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(id)) return null;
  return {
    id,
    name: name.slice(0, 60),
    type: safeNetworkType(input.type),
    rpcUrls,
    explorer,
    identity: /^oct[1-9A-HJ-NP-Za-km-z]{44}$/.test(identity) ? identity : "",
    chainId: String(input.chainId || "").trim().slice(0, 128),
    isDefault: Boolean(input.isDefault)
  };
}

function normalizeRecentEntry(input) {
  if (!input || typeof input !== "object") return null;
  const circleId = String(input.circleId || "").trim();
  if (!/^oct[1-9A-HJ-NP-Za-km-z]{44}$/.test(circleId)) return null;
  const path = normalizeStoredPath(input.path);
  return {
    circleId,
    path,
    display: String(input.display || circleId).slice(0, 512),
    title: String(input.title || "").slice(0, 120),
    networkId: String(input.networkId || "").slice(0, 64),
    mode: String(input.mode || "").slice(0, 32),
    at: Number(input.at) || Date.now()
  };
}

function normalizeStoredPath(value) {
  const raw = String(value || "/index.html").trim();
  const clean = `/${raw.replace(/^\/+/, "")}`;
  return clean.length > 1 && clean.length <= 1024 ? clean : "/index.html";
}

function bookmarkId() {
  return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function bookmarkCircleDisplay(host, path) {
  const cleanHost = String(host || "").replace(/^oct:\/\//i, "").split(/[/?#]/)[0];
  return path === "/index.html" ? `oct://${cleanHost}` : `oct://${cleanHost}${path}`;
}

function normalizeBookmark(input, fallbackNetworkId) {
  if (!input || typeof input !== "object") return null;
  const kind = String(input.kind || "").toLowerCase();
  const networkId = String(input.networkId || fallbackNetworkId || "").slice(0, 64);
  const title = String(input.title || "").slice(0, 120);
  const id = /^[a-z0-9_-]{6,64}$/i.test(String(input.id || "")) ? String(input.id) : bookmarkId();
  const at = Number(input.at) || Date.now();
  if (kind === "circle") {
    const circleId = String(input.circleId || "").trim();
    if (!/^oct[1-9A-HJ-NP-Za-km-z]{44}$/.test(circleId)) return null;
    const path = normalizeStoredPath(input.path);
    const host = String(input.host || circleId).replace(/^oct:\/\//i, "").split(/[/?#]/)[0].slice(0, 256);
    const fallbackDisplay = bookmarkCircleDisplay(host, path);
    const display = /^oct:\/\//i.test(String(input.display || "")) ? String(input.display).slice(0, 512) : fallbackDisplay;
    return {
      id,
      kind,
      key: circleBookmarkKey(networkId, circleId, path),
      circleId,
      host,
      path,
      display,
      title,
      networkId,
      mode: String(input.mode || "").slice(0, 32),
      at
    };
  }
  if (kind === "account") {
    const address = String(input.address || input.circleId || "").trim();
    if (!/^oct[1-9A-HJ-NP-Za-km-z]{44}$/.test(address)) return null;
    return {
      id,
      kind,
      key: accountBookmarkKey(networkId, address),
      address,
      display: address,
      title,
      networkId,
      at
    };
  }
  if (kind === "web") {
    let url;
    try {
      url = new URL(String(input.url || input.display || ""));
    } catch {
      return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const href = url.href.slice(0, 2048);
    return {
      id,
      kind,
      key: webBookmarkKey(href),
      url: href,
      display: href,
      title: title || url.hostname,
      networkId: "",
      at
    };
  }
  return null;
}

export function circleBookmarkKey(networkId, circleId, path) {
  return `circle:${networkId}:${circleId}:${normalizeStoredPath(path)}`;
}

export function accountBookmarkKey(networkId, address) {
  return `account:${networkId}:${address}`;
}

export function webBookmarkKey(url) {
  return `web:${String(url || "")}`;
}

export function findBookmark(settings, key) {
  return settings?.bookmarks?.find((bookmark) => bookmark.key === key) || null;
}

export function normalizeSettings(input) {
  const stored = input && typeof input === "object" ? input : {};
  const storedNetworks = Array.isArray(stored.networks) ? stored.networks : [];
  const byId = new Map();
  for (const network of DEFAULT_NETWORKS) byId.set(network.id, clone(network));
  storedNetworks.forEach((network, index) => {
    const normalized = normalizeNetwork(network, index);
    if (!normalized) return;
    const base = byId.get(normalized.id);
    if (base) {
      const secureEndpoints = normalized.rpcUrls.filter((url) => url.startsWith("https://"));
      normalized.rpcUrls = secureEndpoints.length ? secureEndpoints : base.rpcUrls;
    }
    byId.set(normalized.id, base ? { ...base, ...normalized, isDefault: base.isDefault } : normalized);
  });
  const networks = [...byId.values()];
  const activeNetworkId = networks.some((network) => network.id === stored.activeNetworkId)
    ? stored.activeNetworkId
    : "devnet";
  const recent = [];
  const seen = new Set();
  for (const entry of Array.isArray(stored.recent) ? stored.recent : []) {
    const normalized = normalizeRecentEntry(entry);
    if (!normalized) continue;
    const key = `${normalized.networkId}:${normalized.circleId}:${normalized.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recent.push(normalized);
    if (recent.length >= RECENT_LIMIT) break;
  }
  const bookmarks = [];
  const seenBookmarks = new Set();
  for (const entry of Array.isArray(stored.bookmarks) ? stored.bookmarks : []) {
    const normalized = normalizeBookmark(entry, activeNetworkId);
    if (!normalized || seenBookmarks.has(normalized.key)) continue;
    seenBookmarks.add(normalized.key);
    bookmarks.push(normalized);
    if (bookmarks.length >= BOOKMARK_LIMIT) break;
  }
  return {
    activeNetworkId,
    networks,
    allowRemoteNetwork: stored.allowRemoteNetwork !== false,
    showProtocolBar: stored.showProtocolBar !== false,
    recent,
    bookmarks
  };
}

export function defaultSettings() {
  return normalizeSettings(DEFAULT_SETTINGS);
}

export async function loadSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = normalizeSettings(stored[SETTINGS_KEY]);
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return settings;
}

export async function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: normalized });
  return normalized;
}

export async function patchSettings(patch) {
  const settings = await loadSettings();
  return saveSettings({ ...settings, ...patch });
}

export async function setActiveNetwork(networkId) {
  const settings = await loadSettings();
  if (!settings.networks.some((network) => network.id === networkId)) return settings;
  return saveSettings({ ...settings, activeNetworkId: networkId });
}

export function activeNetwork(settings) {
  if (!settings) return DEFAULT_NETWORKS[1];
  return (
    settings.networks.find((network) => network.id === settings.activeNetworkId) ||
    settings.networks[0] ||
    DEFAULT_NETWORKS[1]
  );
}

export function findNetwork(settings, networkId) {
  return settings?.networks?.find((network) => network.id === networkId) || null;
}

export async function addRecent(entry) {
  const settings = await loadSettings();
  const normalized = normalizeRecentEntry({ ...entry, at: Date.now() });
  if (!normalized) return settings;
  const key = `${normalized.networkId}:${normalized.circleId}:${normalized.path}`;
  const recent = [normalized, ...settings.recent.filter((item) => `${item.networkId}:${item.circleId}:${item.path}` !== key)];
  return saveSettings({ ...settings, recent: recent.slice(0, RECENT_LIMIT) });
}

export async function removeRecent(circleId, path, networkId) {
  const settings = await loadSettings();
  const recent = settings.recent.filter(
    (item) => !(item.circleId === circleId && item.path === path && item.networkId === networkId)
  );
  return saveSettings({ ...settings, recent });
}

export async function clearRecent() {
  return patchSettings({ recent: [] });
}

export const SETTINGS_STORAGE_KEY = SETTINGS_KEY;

export async function saveBookmark(entry) {
  const settings = await loadSettings();
  const normalized = normalizeBookmark({ ...entry, at: Date.now() }, settings.activeNetworkId);
  if (!normalized) return settings;
  const existing = settings.bookmarks.find((bookmark) => bookmark.key === normalized.key);
  if (existing) normalized.id = existing.id;
  if (!normalized.title) normalized.title = normalized.display;
  const bookmarks = [normalized, ...settings.bookmarks.filter((bookmark) => bookmark.key !== normalized.key)];
  return saveSettings({ ...settings, bookmarks: bookmarks.slice(0, BOOKMARK_LIMIT) });
}

export async function deleteBookmark(idOrKey) {
  const settings = await loadSettings();
  const value = String(idOrKey || "");
  const bookmarks = settings.bookmarks.filter((bookmark) => bookmark.id !== value && bookmark.key !== value);
  return saveSettings({ ...settings, bookmarks });
}

export async function clearBookmarks() {
  return patchSettings({ bookmarks: [] });
}