import { activeNetwork } from "./settings.js";

export const OCTRA_ADDRESS_RE = /^oct[1-9A-HJ-NP-Za-km-z]{44}$/;
export const CIRCLE_ID_RE = OCTRA_ADDRESS_RE;

const DEFAULT_TIMEOUT_MS = 25000;
const MAX_ASSET_BYTES = 32 * 1024 * 1024;
const INFO_TTL_MS = 15000;
const NAME_TTL_MS = 5 * 60 * 1000;
const ASSET_TTL_MS = 10000;

const infoCache = new Map();
const nameCache = new Map();
const assetCache = new Map();
const preferredEndpoint = new Map();
const endpointCooldown = new Map();
const RPC_LANES = Array.from({ length: 5 }, () => Promise.resolve());
let rpcLaneIndex = 0;

function withRpcSlot(task) {
  const lane = rpcLaneIndex++ % RPC_LANES.length;
  const run = RPC_LANES[lane].then(task, task);
  RPC_LANES[lane] = run.catch(() => {});
  return run;
}

export function isOctraAddress(value) {
  return CIRCLE_ID_RE.test(String(value || "").trim());
}

export function isSafeRemoteUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) return false;
  if (host.includes(":")) {
    return !(host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80") || host.startsWith("::ffff:"));
  }
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return !(a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224);
}

export function shortAddress(value, head = 10, tail = 7) {
  const clean = String(value || "").trim();
  if (clean.length <= head + tail + 3) return clean;
  return `${clean.slice(0, head)}...${clean.slice(-tail)}`;
}

export function normalizePath(value) {
  let clean = String(value || "").trim();
  if (!clean) return "/index.html";
  clean = clean.split("#")[0].split("?")[0];
  if (!clean.startsWith("/")) clean = `/${clean}`;
  if (clean === "/") return "/index.html";
  try {
    clean = clean.split("/").map((segment) => (segment ? decodeURIComponent(segment) : segment)).join("/");
  } catch {
    // Keep the original path when it contains malformed escapes.
  }
  const parts = [];
  for (const segment of clean.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  const normalized = `/${parts.join("/")}`;
  return normalized === "/" ? "/index.html" : normalized;
}

export function joinPath(basePath, relative) {
  const spec = String(relative || "").trim();
  if (!spec) return null;
  if (spec.startsWith("data:") || spec.startsWith("blob:") || spec.startsWith("#")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(spec) && !/^oct:/i.test(spec)) return null;
  if (spec.startsWith("oct://") || spec.startsWith("oct:")) {
    const parsed = parseTarget(spec);
    return parsed && parsed.kind !== "web" ? parsed.path : null;
  }
  if (spec.startsWith("/")) return normalizePath(spec);
  const parts = normalizePath(basePath || "/index.html").split("/");
  parts.pop();
  for (const segment of spec.split("#")[0].split("?")[0].split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (parts.length > 1) parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return normalizePath(parts.join("/"));
}

export function isValidNameLabel(value, minLength = 1) {
  const label = String(value || "");
  return (
    label.length >= minLength &&
    label.length <= 63 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(label)
  );
}

export function isValidName(value) {
  const name = String(value || "").trim().toLowerCase();
  if (!name.endsWith(".oct")) return false;
  const body = name.slice(0, -4);
  const parts = body.split(".");
  if (parts.length === 1) return isValidNameLabel(parts[0], 3);
  if (parts.length === 2) return isValidNameLabel(parts[0], 1) && isValidNameLabel(parts[1], 3);
  return false;
}

export function parseTarget(rawInput) {
  const raw = String(rawInput || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return { kind: "web", url: raw };
  let value = raw.replace(/^octra:\/\//i, "").replace(/^oct:\/\//i, "").trim();
  if (!value) return null;
  const hashless = value.split("#")[0];
  const main = hashless.split("?")[0];
  const slash = main.indexOf("/");
  const hostRaw = (slash >= 0 ? main.slice(0, slash) : main).trim();
  const path = normalizePath(slash >= 0 ? main.slice(slash) : "/");
  if (!hostRaw) return null;
  if (isOctraAddress(hostRaw)) {
    return { kind: "address", host: hostRaw, path, explicitScheme: /^oct:\/\//i.test(raw) };
  }
  const host = hostRaw.toLowerCase().replace(/\.+$/, "");
  if (isValidName(host)) {
    return { kind: "name", host, name: host, path, explicitScheme: /^oct:\/\//i.test(raw) };
  }
  if (looksLikeWeb(raw)) return { kind: "web", url: raw.includes("://") ? raw : `https://${raw}` };
  return null;
}

export function looksLikeWeb(value) {
  return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i.test(String(value || "").trim());
}

export function circleUri(host, path) {
  const cleanPath = normalizePath(path);
  return cleanPath === "/index.html" ? `oct://${host}` : `oct://${host}${cleanPath}`;
}

export function rpcEndpoint(value) {
  const clean = String(value || "").trim().replace(/\/+$/, "");
  if (!clean) return "";
  return clean.endsWith("/rpc") ? clean : `${clean}/rpc`;
}

export function explorerAddressUrl(explorer, address) {
  const base = String(explorer || "").replace(/\/+$/, "");
  if (!base) return "";
  return `${base}/address.html?addr=${encodeURIComponent(address)}`;
}

function getCache(cache, key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function putCache(cache, key, value, ttl) {
  if (cache.size > 256) cache.clear();
  cache.set(key, { value, expiresAt: Date.now() + ttl });
}

export function clearCaches() {
  infoCache.clear();
  nameCache.clear();
  assetCache.clear();
  preferredEndpoint.clear();
  endpointCooldown.clear();
}

export function clearNameCache() {
  nameCache.clear();
}

export async function rpc(network, payload, options = {}) {
  const endpoints = Array.isArray(network?.rpcUrls) ? network.rpcUrls : [];
  if (!endpoints.length) throw new Error("No RPC endpoint is configured for this network.");
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const preferred = preferredEndpoint.get(network.id);
  const ordered = preferred
    ? [preferred, ...endpoints.filter((url) => url !== preferred)]
    : endpoints;
  const now = Date.now();
  const available = ordered.filter((url) => (endpointCooldown.get(url) || 0) <= now);
  const candidates = available.length ? available : ordered;
  return withRpcSlot(async () => {
    let lastError = null;
    for (const endpoint of candidates) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(rpcEndpoint(endpoint), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal,
            cache: "no-store",
            credentials: "omit",
            referrerPolicy: "no-referrer"
          });
          if (!response.ok) {
            if (response.status === 429) endpointCooldown.set(endpoint, Date.now() + 30000);
            else if (response.status >= 500) endpointCooldown.set(endpoint, Date.now() + 8000);
            throw new Error(`RPC HTTP ${response.status}`);
          }
          const text = await response.text();
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            throw new Error("RPC returned invalid JSON.");
          }
          const transient = json?.error && /committed state changed|temporarily|try again|retry/i.test(String(json.error.message || ""));
          if (transient && attempt < 2) {
            await delay(180 * (attempt + 1));
            continue;
          }
          endpointCooldown.delete(endpoint);
          preferredEndpoint.set(network.id, endpoint);
          return json;
        } catch (error) {
          lastError = error?.name === "AbortError"
            ? new Error(`RPC timed out after ${Math.round(timeoutMs / 1000)}s`)
            : error;
          break;
        } finally {
          clearTimeout(timer);
        }
      }
    }
    throw new Error(`RPC unavailable: ${lastError?.message || "no endpoint responded"}`);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function unwrap(result) {
  if (result && typeof result === "object" && "result" in result && Object.keys(result).length <= 2) {
    return result.result;
  }
  return result;
}

export async function circleInfo(network, circleId, options = {}) {
  const key = `${network.id}:${circleId}`;
  if (!options.force) {
    const cached = getCache(infoCache, key);
    if (cached !== undefined) return cached;
  }
  const response = await rpc(network, {
    jsonrpc: "2.0",
    id: 1,
    method: "circle_info",
    params: [circleId]
  });
  if (response?.error) {
    const error = new Error(response.error.message || "Circle info lookup failed.");
    error.code = response.error.code;
    error.data = response.error.data;
    throw error;
  }
  const info = response?.result;
  if (!info) throw new Error("Circle info was not returned.");
  putCache(infoCache, key, info, INFO_TTL_MS);
  return info;
}

export function isCircleNotFound(error) {
  const detail = `${error?.message || ""} ${typeof error?.data === "string" ? error.data : ""}`;
  return Number(error?.code) === 112 || /circle\s+not\s+found|not\s+found/i.test(detail);
}

export function isSealedInfo(info) {
  if (!info) return false;
  const mode = String(info.resource_mode || "").toLowerCase();
  const privacy = String(info.privacy_class || "").toLowerCase();
  return (
    mode.includes("sealed") ||
    mode.includes("encrypted") ||
    privacy.includes("sealed") ||
    privacy.includes("private") ||
    privacy.includes("encrypted")
  );
}

export function isPublicInfo(info) {
  return !isSealedInfo(info);
}

export async function fetchCircleAsset(network, circleId, path, options = {}) {
  const cleanPath = normalizePath(path);
  const key = `${network.id}:${circleId}:${cleanPath}`;
  if (!options.force) {
    const cached = getCache(assetCache, key);
    if (cached !== undefined) return cached;
  }
  const response = await rpc(network, {
    jsonrpc: "2.0",
    id: 1,
    method: "circle_asset",
    params: [circleId, cleanPath]
  });
  if (response?.error) throw new Error(response.error.message || "Circle asset lookup failed.");
  const result = response?.result;
  if (!result?.body_b64) throw new Error(`Circle asset was not found: ${cleanPath}`);
  if (Number(result.size_bytes || 0) > MAX_ASSET_BYTES) throw new Error("Circle asset exceeds the 32 MB limit.");
  const asset = {
    circleId: result.circle_id || circleId,
    path: normalizePath(result.canonical_path || cleanPath),
    contentType: String(result.content_type || "application/octet-stream").toLowerCase(),
    encoding: result.encoding || "identity",
    body: base64ToBytes(result.body_b64),
    sizeBytes: Number(result.size_bytes || 0)
  };
  putCache(assetCache, key, asset, ASSET_TTL_MS);
  return asset;
}

export async function fetchSealedCircleAsset(network, circleId, path, passphrase, options = {}) {
  const cleanPath = normalizePath(path);
  const key = `${network.id}:${circleId}:sealed:${cleanPath}:${await digestText(passphrase)}`;
  if (!options.force) {
    const cached = getCache(assetCache, key);
    if (cached !== undefined) return cached;
  }
  const ciphertext = await fetchCiphertext(network, circleId, cleanPath);
  if (!ciphertext?.ciphertext_b64 || !ciphertext?.key_id || !ciphertext?.plaintext_hash) {
    throw new Error("Sealed asset metadata is incomplete.");
  }
  if (String(ciphertext.ciphertext_b64 || "").length > MAX_ASSET_BYTES * 1.5) throw new Error("Sealed Circle asset exceeds the 32 MB limit.");
  const body = await decryptSealedBytes(circleId, ciphertext, passphrase);
  const asset = {
    circleId: ciphertext.circle_id || circleId,
    path: normalizePath(ciphertext.canonical_path || cleanPath),
    contentType: String(ciphertext.content_type || "application/octet-stream").toLowerCase(),
    encoding: ciphertext.encoding || "identity",
    body,
    sizeBytes: body.byteLength
  };
  putCache(assetCache, key, asset, ASSET_TTL_MS);
  return asset;
}

async function fetchCiphertext(network, circleId, path) {
  const resourceKey = await circleResourceKey(circleId, path);
  const byKey = await rpc(network, {
    jsonrpc: "2.0",
    id: 1,
    method: "circle_asset_ciphertext_by_resource_key",
    params: [circleId, resourceKey]
  }).catch(() => null);
  if (byKey?.result && !byKey.error) return byKey.result;
  const response = await rpc(network, {
    jsonrpc: "2.0",
    id: 1,
    method: "circle_asset_ciphertext",
    params: [circleId, path]
  });
  if (response?.error) throw new Error(response.error.message || "Sealed asset lookup failed.");
  if (!response?.result) throw new Error("Sealed asset was not found.");
  return response.result;
}

export async function contractCall(network, contractAddress, method, params, options = {}) {
  const response = await rpc(network, {
    jsonrpc: "2.0",
    id: 1,
    method: "contract_call",
    params: [contractAddress, method, params || []]
  }, options);
  if (response?.error) throw new Error(response.error.message || "Contract call failed.");
  return unwrap(response?.result);
}

export async function resolveName(network, rawName) {
  const name = String(rawName || "").trim().toLowerCase().replace(/\.oct$/i, "");
  if (!isValidName(`${name}.oct`)) return null;
  const key = `${network.id}:${network.identity}:${name}`;
  const cached = getCache(nameCache, key);
  if (cached !== undefined) return cached;
  if (!isOctraAddress(network.identity)) {
    throw new Error("The active network has no Octra Name Service contract configured.");
  }
  const method = name.includes(".") ? "resolve_name" : "resolve";
  let resolved = await contractCall(network, network.identity, method, [name]).catch(() => null);
  if (!isOctraAddress(unwrap(resolved)) && name.includes(".")) {
    resolved = await contractCall(network, network.identity, "resolve", [name]).catch(() => null);
  }
  const value = isOctraAddress(unwrap(resolved)) ? unwrap(resolved) : null;
  putCache(nameCache, key, value, NAME_TTL_MS);
  return value;
}

export async function resolveTarget(rawInput, settings, options = {}) {
  const network = options.network || activeNetwork(settings);
  const spec = parseTarget(rawInput);
  if (!spec) throw new Error("Enter an Octra address, a .oct name, or an oct:// URL.");
  if (spec.kind === "web") {
    return { kind: "web", url: spec.url, title: new URL(spec.url).hostname };
  }
  options.onProgress?.({ stage: "detected", spec });
  let address = spec.host;
  if (spec.kind === "name") {
    options.onProgress?.({ stage: "resolving", name: spec.name });
    address = await resolveName(network, spec.name);
    if (!address) {
      throw new Error(`${spec.name} is not registered on ${network.name}.`);
    }
    options.onProgress?.({ stage: "resolved", name: spec.name, address });
  }
  options.onProgress?.({ stage: "checking", address });
  let info;
  try {
    info = await circleInfo(network, address);
  } catch (error) {
    if (!isCircleNotFound(error)) throw error;
    const explorerUrl = explorerAddressUrl(network.explorer, address);
    return {
      kind: "account",
      address,
      name: spec.name || null,
      path: spec.path,
      network,
      explorerUrl,
      display: spec.name || address
    };
  }
  const mode = isSealedInfo(info) ? "sealed" : "public";
  const host = spec.name || address;
  return {
    kind: "circle",
    circleId: address,
    address,
    name: spec.name || null,
    path: spec.path,
    info,
    mode,
    network,
    display: circleUri(host, spec.path),
    host
  };
}

export async function runtimeVersion(network) {
  const response = await rpc(network, {
    jsonrpc: "2.0",
    id: 1,
    method: "octra_runtimeVersion",
    params: []
  });
  if (response?.error) {
    if (/method not found|-32601/i.test(response.error.message || "")) return null;
    throw new Error(response.error.message || "Runtime identity lookup failed.");
  }
  return response?.result || null;
}

export async function nodeStatus(network) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const started = performance.now();
    try {
      const response = await rpc(network, {
        jsonrpc: "2.0",
        id: 1,
        method: "node_status",
        params: []
      }, { timeoutMs: 12000 });
      if (response?.error) throw new Error(response.error.message || "node_status failed.");
      const runtime = await runtimeVersion(network).catch(() => null);
      return {
        ...response.result,
        chainId: runtime?.chain_id || null,
        nodeVersion: runtime?.node_version || response.result?.network_version || null,
        latencyMs: Math.round(performance.now() - started)
      };
    } catch (error) {
      lastError = error;
      if (!/committed state changed|retry|timed out|HTTP 429|HTTP 5/i.test(error?.message || "")) break;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError || new Error("node_status failed.");
}

export const CIRCLE_READ_METHODS = new Set([
  "octra_callProgramView",
  "octra_circleProgramInfo",
  "octra_circleView",
  "contract_call",
  "circle_info",
  "circle_asset",
  "node_status",
  "epoch_current",
  "octra_balance",
  "octra_account",
  "octra_transaction",
  "contract_receipt",
  "octra_recommendedFee",
  "octra_feeEstimate",
  "octra_contractInfo",
  "octra_runtimeVersion",
  "octra_epochCurrent"
]);

export async function circleReadRpc(network, method, params) {
  if (method === "octra_callProgramView") {
    const request = params?.[0] || {};
    return programView(network, request.address, request.method, request.params || []);
  }
  const response = await rpc(network, {
    jsonrpc: "2.0",
    id: 1,
    method,
    params: params || []
  });
  if (response?.error) throw new Error(response.error.message || "Circle RPC failed.");
  return response.result ?? null;
}

export async function programView(network, address, method, params) {
  const cleanMethod = String(method || "").trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(cleanMethod)) {
    throw new Error("Program method is invalid.");
  }
  const response = await rpc(network, {
    jsonrpc: "2.0",
    id: 1,
    method: "octra_callProgramView",
    params: [{ address, method: cleanMethod, params: params || [] }]
  }).catch(async (error) => {
    if (!/method not found|-32601/i.test(error.message || "")) throw error;
    return null;
  });
  if (response && !response.error) return response.result ?? null;
  if (response?.error && !/method not found|-32601/i.test(response.error.message || "")) {
    throw new Error(response.error.message || "Program view failed.");
  }
  const circleView = await rpc(network, {
    jsonrpc: "2.0",
    id: 1,
    method: "octra_circleView",
    params: [address, cleanMethod, params || [], null, false]
  }).catch(async (error) => {
    if (!/method not found|-32601/i.test(error.message || "")) throw error;
    return null;
  });
  if (circleView && !circleView.error) return circleView.result ?? null;
  if (circleView?.error && !/method not found|-32601/i.test(circleView.error.message || "")) {
    throw new Error(circleView.error.message || "Program view failed.");
  }
  return contractCall(network, address, cleanMethod, params || []);
}

export async function forwardCircleRpcPayload(network, payload) {
  if (Array.isArray(payload)) {
    if (payload.length > 8) throw new Error("JSON-RPC batch limit is 8 requests.");
    return Promise.all(payload.map((entry) => forwardCircleRpcPayload(network, entry)));
  }
  if (!payload || typeof payload !== "object") {
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid JSON-RPC request." } };
  }
  const id = payload.id ?? null;
  const method = String(payload.method || "");
  if (!CIRCLE_READ_METHODS.has(method)) {
    return { jsonrpc: "2.0", id, error: { code: -32601, message: "RPC method is not allowed in a Circle sandbox." } };
  }
  try {
    const params = Array.isArray(payload.params) ? payload.params : [];
    const result = await circleReadRpc(network, method, params);
    return { jsonrpc: "2.0", id, result };
  } catch (error) {
    return { jsonrpc: "2.0", id, error: { code: -32000, message: error.message || "Circle RPC failed." } };
  }
}

export function extractHtmlTitle(assetOrText) {
  let html = "";
  if (typeof assetOrText === "string") html = assetOrText;
  else if (assetOrText?.body) html = bytesToText(assetOrText.body);
  else return null;
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  return decodeEntities(match[1].replace(/\s+/g, " ").trim()).slice(0, 80) || null;
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function base64ToBytes(value) {
  const binary = atob(String(value || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export function bytesToText(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}

export function bytesToDataUrl(contentType, bytes) {
  return `data:${contentType || "application/octet-stream"};base64,${bytesToBase64(bytes)}`;
}

export function textToDataUrl(contentType, value) {
  return bytesToDataUrl(contentType, new TextEncoder().encode(value));
}

export async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return hex(digest);
}

export async function digestText(value) {
  return sha256Hex(new TextEncoder().encode(String(value || "")));
}

function hex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

function readU32Be(bytes, offset) {
  return (
    ((bytes[offset] & 0xff) << 24) |
    ((bytes[offset + 1] & 0xff) << 16) |
    ((bytes[offset + 2] & 0xff) << 8) |
    (bytes[offset + 3] & 0xff)
  ) >>> 0;
}

function frameBytes(bytes) {
  const out = new Uint8Array(bytes.length + 4);
  out[0] = (bytes.length >>> 24) & 0xff;
  out[1] = (bytes.length >>> 16) & 0xff;
  out[2] = (bytes.length >>> 8) & 0xff;
  out[3] = bytes.length & 0xff;
  out.set(bytes, 4);
  return out;
}

async function circleResourceKey(circleId, canonicalPath) {
  const encoder = new TextEncoder();
  const frames = [
    encoder.encode("octra:circle_resource_key:v1"),
    new Uint8Array([0]),
    frameBytes(encoder.encode(circleId)),
    frameBytes(encoder.encode(normalizePath(canonicalPath)))
  ];
  const total = frames.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of frames) {
    out.set(part, offset);
    offset += part.length;
  }
  return sha256Hex(out);
}

function validateSealedText(value) {
  const text = String(value ?? "");
  for (const character of text) {
    const code = character.codePointAt(0);
    if (code >= 0xd800 && code <= 0xdfff) throw new Error("Sealed circle key material contains invalid characters.");
  }
  return text;
}

async function deriveReadKey(circleId, keyId, passphrase) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(validateSealedText(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const salt = new TextEncoder().encode(`octra:circle:sealed_read:v1:${circleId}:${keyId}`);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
}

function sealedDigestSalt(circleId, keyId) {
  return JSON.stringify(["octra:circle:sealed_digest", circleId, keyId]).replace(/\u007f/g, "\\u007f");
}

async function sealedDigestForSalt(salt, passphrase, plaintext) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(validateSealedText(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 120000, hash: "SHA-256" },
    material,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"]
  );
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, plaintext)));
}

export async function decryptSealedBytes(circleId, asset, passphrase) {
  if (!asset?.key_id || !/^[0-9a-f]{64}$/i.test(String(asset.plaintext_hash || ""))) {
    throw new Error("Sealed asset metadata is incomplete.");
  }
  const envelope = base64ToBytes(asset.ciphertext_b64 || "");
  const magic = new TextEncoder().encode("OCRS1");
  if (envelope.length < magic.length + 12 + 16) throw new Error("Invalid sealed circle envelope.");
  if (!bytesEqual(envelope.subarray(0, magic.length), magic)) throw new Error("Invalid sealed circle envelope.");
  const nonce = envelope.subarray(magic.length, magic.length + 12);
  const cipher = envelope.subarray(magic.length + 12);
  const key = await deriveReadKey(circleId, asset.key_id, passphrase);
  let frame;
  try {
    frame = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, key, cipher));
  } catch {
    throw new Error("The passphrase did not unlock this Circle.");
  }
  if (frame.length < 4) throw new Error("Invalid sealed circle payload.");
  const size = readU32Be(frame, 0);
  if (size > frame.length - 4) throw new Error("Invalid sealed circle payload length.");
  const plaintext = frame.subarray(4, 4 + size);
  const expected = String(asset.plaintext_hash).toLowerCase();
  if (await sha256Hex(plaintext) === expected) return plaintext;
  if (await sealedDigestForSalt(sealedDigestSalt(circleId, asset.key_id), passphrase, plaintext) === expected) {
    return plaintext;
  }
  const browserSalt = JSON.stringify(["octra:circle:sealed_digest", circleId, asset.key_id]);
  if (browserSalt !== sealedDigestSalt(circleId, asset.key_id)) {
    if (await sealedDigestForSalt(browserSalt, passphrase, plaintext) === expected) return plaintext;
  }
  throw new Error("Sealed payload integrity check failed.");
}

export function isHtmlContentType(value) {
  return /text\/html|application\/xhtml\+xml/i.test(String(value || ""));
}

export function isCssContentType(value) {
  return /text\/css/i.test(String(value || ""));
}

export function isScriptContentType(value) {
  return /javascript|ecmascript/i.test(String(value || ""));
}

export function isTextContentType(value) {
  const type = String(value || "").toLowerCase();
  return (
    type.startsWith("text/") ||
    type.includes("json") ||
    type.includes("xml") ||
    type.includes("javascript") ||
    type.includes("ecmascript")
  );
}

export function isDownloadPath(path) {
  return /\.(?:apk|exe|msi|pdf|zip|7z|rar|dmg|deb|rpm|tar|gz|tgz|bz2|xz|csv|docx?|xlsx?|pptx?|mp3|mp4|woff2?|ttf|otf|wasm)$/i.test(String(path || ""));
}

export function splitSrcset(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [url, ...descriptor] = part.split(/\s+/);
      return { url, descriptor: descriptor.join(" ") };
    });
}
