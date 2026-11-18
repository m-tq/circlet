import { activeNetwork, loadSettings } from "./core/settings.js";
import { resolveTarget, shortAddress } from "./core/octra.js";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "circlet-open",
      title: "Open with circlet",
      contexts: ["link", "selection"]
    });
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  const input = info.linkUrl || info.selectionText || "";
  if (input) openResolver(input, "newForegroundTab").catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "open-circlet-input") return false;
  const disposition = message.disposition || "currentTab";
  const tabId = disposition === "currentTab" ? sender.tab?.id ?? null : null;
  openResolver(message.input, disposition, tabId)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, message: error?.message || "Unable to open destination." }));
  return true;
});

const DEFAULT_SUGGESTION = "Open an Octra Circle by address, oct:// URI, or .oct name";
let suggestTimer = null;
let suggestSeq = 0;

chrome.omnibox.onInputStarted.addListener(() => {
  chrome.omnibox.setDefaultSuggestion({ description: DEFAULT_SUGGESTION });
});

chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  const input = normalizeDestination(text);
  clearTimeout(suggestTimer);
  const seq = ++suggestSeq;
  if (!input) {
    suggest([]);
    chrome.omnibox.setDefaultSuggestion({ description: DEFAULT_SUGGESTION });
    return;
  }
  const pending = `Resolve <match>${escapeXml(input)}</match> on the active Octra network`;
  chrome.omnibox.setDefaultSuggestion({ description: pending });
  suggest([{ content: input, description: pending }]);
  suggestTimer = setTimeout(async () => {
    try {
      const settings = await loadSettings();
      const target = await resolveTarget(input, settings);
      if (seq !== suggestSeq) return;
      const description = describeTarget(target, input);
      chrome.omnibox.setDefaultSuggestion({ description });
      suggest([{ content: input, description }]);
    } catch (error) {
      if (seq !== suggestSeq) return;
      const description = `<match>${escapeXml(input)}</match> <dim>${escapeXml(error?.message || "Unable to resolve")}</dim>`;
      chrome.omnibox.setDefaultSuggestion({ description });
      suggest([{ content: input, description }]);
    }
  }, 320);
});

chrome.omnibox.onInputEntered.addListener((text, disposition) => {
  clearTimeout(suggestTimer);
  suggestSeq += 1;
  openResolver(normalizeDestination(text), disposition || "currentTab").catch(() => {});
});

chrome.omnibox.onInputCancelled.addListener(() => {
  clearTimeout(suggestTimer);
  suggestSeq += 1;
});

const routed = new Map();

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0 || details.tabId < 0) return;
  const input = destinationFromUrl(details.url);
  if (input) routeNavigation(details.tabId, input);
});

chrome.webNavigation.onErrorOccurred.addListener((details) => {
  if (details.frameId !== 0 || details.tabId < 0) return;
  if (!/ERR_NAME_NOT_RESOLVED|DNS_PROBE_FINISHED_NXDOMAIN|ERR_UNKNOWN_URL_SCHEME|ERR_DISALLOWED_URL_SCHEME/i.test(details.error || "")) return;
  const input = destinationFromUrl(details.url);
  if (input) routeNavigation(details.tabId, input);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  const candidate = changeInfo.pendingUrl || changeInfo.url || "";
  const input = destinationFromUrl(candidate);
  if (input) routeNavigation(tabId, input);
});

function routeNavigation(tabId, input) {
  const key = `${tabId}:${input}`;
  const now = Date.now();
  if (now - (routed.get(key) || 0) < 1500) return;
  routed.set(key, now);
  openResolver(input, "currentTab", tabId).catch(() => {}).finally(() => {
    setTimeout(() => routed.delete(key), 1800);
  });
}

function normalizeDestination(value) {
  let input = String(value || "").trim().replace(/^circlet\s+/i, "").trim();
  if (!input) return "";
  if (/^[a-z0-9][a-z0-9-]{0,62}$/i.test(input)) input = `${input}.oct`;
  return input;
}

function destinationFromUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^oct:\/\//i.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return null;
    if (!url.hostname.toLowerCase().endsWith(".oct")) return null;
    return `${url.hostname}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

async function openResolver(rawInput, disposition = "newForegroundTab", tabId = null) {
  const input = normalizeDestination(rawInput);
  if (!input) throw new Error("Enter an Octra destination.");
  const settings = await loadSettings();
  const network = activeNetwork(settings);
  const url = chrome.runtime.getURL(`resolve.html?raw=${encodeURIComponent(input)}&net=${encodeURIComponent(network.id)}`);
  if (disposition === "currentTab") {
    if (tabId != null) {
      await chrome.tabs.update(tabId, { url });
      return;
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id != null) {
      await chrome.tabs.update(tab.id, { url });
      return;
    }
  }
  await chrome.tabs.create({ url, active: disposition !== "newBackgroundTab" });
}

function describeTarget(target, input) {
  if (target.kind === "web") {
    return `<match>${escapeXml(target.title || input)}</match> <dim>regular website · opening externally</dim>`;
  }
  if (target.kind === "account") {
    return `<match>${escapeXml(target.name || shortAddress(target.address))}</match> <dim>account · open in explorer</dim>`;
  }
  if (target.kind === "circle") {
    const mode = target.mode === "sealed" ? "sealed Circle · passphrase required" : "public Circle app";
    const label = target.name ? `${target.name} → ${shortAddress(target.circleId)}` : shortAddress(target.circleId);
    return `<match>${escapeXml(label)}</match> <dim>${escapeXml(mode)} · ${escapeXml(target.network.name)}</dim>`;
  }
  return `<match>${escapeXml(input)}</match>`;
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
