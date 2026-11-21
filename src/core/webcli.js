import { normalizeSettings } from "./settings.js";

const TOKEN_KEY = "circlet:webcli:token";
const WALLET_KEY = "circlet:webcli:wallet";
const DEFAULT_URL = "http://127.0.0.1:8420";
let cachedToken = "";
let cachedWallet = null;
let cachedTabId = null;
let operationQueue = Promise.resolve();

function queue(task) {
  const run = operationQueue.then(task, task);
  operationQueue = run.catch(() => {});
  return run;
}

export async function webcliBaseUrl() {
  const stored = await chrome.storage.local.get("circlet:settings:v1").catch(() => ({}));
  return normalizeSettings(stored["circlet:settings:v1"]).webcliUrl || DEFAULT_URL;
}

async function readToken() {
  if (cachedToken) return cachedToken;
  const stored = await chrome.storage.session.get(TOKEN_KEY).catch(() => ({}));
  cachedToken = typeof stored[TOKEN_KEY] === "string" ? stored[TOKEN_KEY] : "";
  return cachedToken;
}

async function writeToken(value) {
  cachedToken = String(value || "");
  if (cachedToken) await chrome.storage.session.set({ [TOKEN_KEY]: cachedToken }).catch(() => {});
  else await chrome.storage.session.remove(TOKEN_KEY).catch(() => {});
}

async function readWallet() {
  if (cachedWallet) return cachedWallet;
  const stored = await chrome.storage.session.get(WALLET_KEY).catch(() => ({}));
  const value = stored[WALLET_KEY];
  cachedWallet = value && typeof value === "object" ? value : null;
  return cachedWallet;
}

async function writeWallet(value) {
  cachedWallet = value && value.address ? {
    address: String(value.address || ""),
    generation: String(value.generation || "")
  } : null;
  if (cachedWallet) await chrome.storage.session.set({ [WALLET_KEY]: cachedWallet }).catch(() => {});
  else await chrome.storage.session.remove(WALLET_KEY).catch(() => {});
}

function needsScoped(path, method) {
  if (method === "GET" || method === "HEAD") return false;
  return path.startsWith("/api/circle/") ||
    path.startsWith("/api/program/") ||
    path.startsWith("/api/fhe/") ||
    path.startsWith("/api/stealth/") ||
    path.startsWith("/api/pvac/") ||
    path.startsWith("/api/tx/") ||
    path === "/api/send" ||
    path === "/api/key_switch" ||
    path === "/api/encrypt" ||
    path === "/api/decrypt" ||
    path === "/api/token/transfer" ||
    path === "/api/contract/deploy" ||
    path === "/api/contract/call" ||
    path === "/api/keys/private";
}

async function waitForTab(tabId) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return false;
    if (tab.status === "complete" && !tab.discarded) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function ensureTab(base) {
  if (cachedTabId) {
    const existing = await chrome.tabs.get(cachedTabId).catch(() => null);
    if (existing?.url?.startsWith(`${base}/`)) {
      if (existing.discarded) await chrome.tabs.reload(cachedTabId).catch(() => {});
      if (await waitForTab(cachedTabId)) return cachedTabId;
    }
    cachedTabId = null;
  }
  const tabs = await chrome.tabs.query({});
  const found = tabs.find((tab) => tab.id != null && typeof tab.url === "string" && tab.url.startsWith(`${base}/`));
  if (found) {
    cachedTabId = found.id;
    if (found.discarded) await chrome.tabs.reload(cachedTabId).catch(() => {});
    if (await waitForTab(cachedTabId)) return cachedTabId;
  }
  const created = await chrome.tabs.create({ url: `${base}/`, active: false });
  if (created.id == null) throw new Error("Unable to open the webcli tab.");
  cachedTabId = created.id;
  if (!(await waitForTab(cachedTabId))) throw new Error("webcli did not finish loading.");
  return cachedTabId;
}

async function runFetch(base, path, method, body, token, scopedWallet = null) {
  if (!/^\/api\/[A-Za-z0-9_./?=&%-]*$/.test(path) || path.includes("..")) throw new Error("Invalid webcli API path.");
  const tabId = await ensureTab(base);
  const url = `${base}${path}`;
  const bodyText = body == null ? null : JSON.stringify(body);
  const results = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    world: "ISOLATED",
    func: async (targetUrl, httpMethod, payload, bearer, walletAddress, walletGeneration) => {
      const headers = {};
      if (payload != null) headers["Content-Type"] = "application/json";
      if (bearer) headers.Authorization = `Bearer ${bearer}`;
      if (walletAddress && walletGeneration) {
        headers["X-Webcli-Wallet"] = walletAddress;
        headers["X-Webcli-Generation"] = walletGeneration;
      }
      try {
        const response = await fetch(targetUrl, {
          method: httpMethod,
          headers,
          body: payload,
          credentials: "omit",
          cache: "no-store"
        });
        const text = await response.text();
        return {
          status: response.status,
          ok: response.ok,
          text,
          session: response.headers.get("X-Webcli-Session") || "",
          retryAfter: response.headers.get("Retry-After") || ""
        };
      } catch (error) {
        return { status: 0, ok: false, text: "", error: error?.message || "fetch failed" };
      }
    },
    args: [url, method, bodyText, token, scopedWallet?.address || "", scopedWallet?.generation || ""]
  });
  const result = results?.[0]?.result;
  if (!result) throw new Error("webcli did not return a response.");
  let data = null;
  try {
    data = result.text ? JSON.parse(result.text) : null;
  } catch {
    data = result.text ? { message: result.text } : null;
  }
  return { ...result, data };
}

function errorFrom(result, fallback) {
  const message = result?.data?.error || result?.data?.message || result?.error || fallback || `webcli HTTP ${result?.status || 0}`;
  const error = new Error(message);
  error.status = result?.status || 0;
  error.data = result?.data || null;
  if (result?.status === 401) error.code = "WEBLCI_AUTH_REQUIRED";
  if (result?.status === 429) error.code = "WEBLCI_RATE_LIMITED";
  return error;
}

async function execute(path, method = "GET", body = null, options = {}) {
  const base = await webcliBaseUrl();
  const token = options.auth === false ? "" : await readToken();
  if (options.auth !== false && !token) {
    const error = new Error("Wallet sign-in required.");
    error.code = "WEBLCI_AUTH_REQUIRED";
    throw error;
  }
  const wallet = needsScoped(path, method) ? await readWallet() : null;
  let result;
  try {
    result = await runFetch(base, path, method, body, token, wallet);
  } catch (error) {
    cachedTabId = null;
    result = await runFetch(base, path, method, body, token, wallet);
  }
  if (result.session === "signed-out") await writeToken("");
  else if (/^[0-9a-f]{64}$/.test(result.session || "")) await writeToken(result.session);
  if (result.status === 401 && options.auth !== false) await writeToken("");
  if (result.ok && path === "/api/wallet" && result.data?.address) {
    await writeWallet(result.data);
  }
  return result;
}

export async function webcliHasToken() {
  return Boolean(await readToken());
}

export async function webcliBrowserStatus() {
  const result = await execute("/api/browser/status", "GET", null, { auth: false });
  if (!result.ok) throw errorFrom(result, "webcli is unavailable.");
  return result.data || {};
}

export async function webcliSessionStatus() {
  const browser = await webcliBrowserStatus();
  const token = await readToken();
  if (!token) return { browser, wallet: null, accounts: null, connected: false };
  const walletResult = await execute("/api/wallet", "GET");
  if (!walletResult.ok) {
    if (walletResult.status === 401) return { browser, wallet: null, accounts: null, connected: false };
    throw errorFrom(walletResult, "Unable to read webcli wallet.");
  }
  const accountsResult = await execute("/api/wallet/accounts", "GET");
  return {
    browser,
    wallet: walletResult.data || null,
    accounts: accountsResult.ok ? accountsResult.data || null : null,
    connected: true
  };
}

export async function webcliLogin(address, pin) {
  if (!address || !pin) throw new Error("Wallet address and PIN are required.");
  const result = await execute("/api/browser/login", "POST", { addr: address, pin }, { auth: false });
  if (!result.ok) throw errorFrom(result, "Wallet sign-in failed.");
  if (/^[0-9a-f]{64}$/.test(result.session || "")) await writeToken(result.session);
  else {
    const token = await readToken();
    if (!token) throw new Error("webcli did not issue a wallet session.");
  }
  const walletResult = await execute("/api/wallet", "GET");
  if (walletResult.ok) await writeWallet(walletResult.data);
  return result.data || {};
}

export async function webcliSetToken(value) {
  const token = String(value || "").trim();
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("webcli API key must be 64 hex characters.");
  const previous = await readToken();
  await writeToken(token);
  const result = await execute("/api/wallet", "GET");
  if (!result.ok && result.status === 401) {
    await writeToken(previous);
    throw errorFrom(result, "webcli API key was rejected.");
  }
  return result.data || {};
}

export async function webcliRequest(path, method = "GET", body = null, options = {}) {
  return queue(async () => {
    const result = await execute(path, method, body, options);
    if (!result.ok) throw errorFrom(result, "webcli request failed.");
    return result.data;
  });
}

export async function webcliLogout(lock) {
  return queue(async () => {
    if (lock) {
      const token = await readToken();
      if (token) {
        const result = await execute("/api/wallet/lock", "POST", {}, { auth: true }).catch(() => null);
        if (result && !result.ok && result.status !== 409 && result.status !== 401) throw errorFrom(result, "Unable to lock webcli wallet.");
      }
    }
    await writeToken("");
    await writeWallet(null);
    return true;
  });
}

export async function webcliOpen() {
  const base = await webcliBaseUrl();
  const tabId = await ensureTab(base);
  const tab = await chrome.tabs.update(tabId, { active: true });
  if (tab?.windowId != null && chrome.windows?.update) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  return true;
}

export async function isWebcliTab(tabId) {
  return tabId === cachedTabId;
}
