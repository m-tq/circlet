import {
  activeNetwork,
  addRecent,
  circleBookmarkKey,
  deleteBookmark,
  deleteDapp,
  findBookmark,
  findDapp,
  loadSettings,
  normalizeSettings,
  saveBookmark,
  saveDapp,
  setActiveNetwork
} from "../core/settings.js";
import {
  bytesToDataUrl,
  bytesToText,
  circleInfo,
  circleUri,
  explorerAddressUrl,
  extractHtmlTitle,
  fetchCircleAsset,
  fetchSealedCircleAsset,
  forwardCircleRpcPayload,
  isCircleNotFound,
  isHtmlContentType,
  isSafeRemoteUrl,
  isSealedInfo,
  isTextContentType,
  nodeStatus,
  normalizePath,
  parseTarget,
  programView,
  resolveTarget,
  rpc,
  shortAddress
} from "../core/octra.js";
import { buildDocument } from "../core/render.js";

const PARAMS = new URLSearchParams(location.search);
const DEFAULT_FAVICON = chrome.runtime.getURL("assets/icon.svg");
const SANDBOX_URL = chrome.runtime.getURL("sandbox.html");
const SEALED_TTL_MS = 15 * 60 * 1000;
const MAX_STORAGE_ENTRIES = 256;
const MAX_STORAGE_VALUE = 64 * 1024;
const MAX_STORAGE_TOTAL = 1024 * 1024;
const MAX_ASSET_BYTES = 32 * 1024 * 1024;
const rateHistory = new Map();

function allowRate(name, limit, windowMs) {
  const now = Date.now();
  const recent = (rateHistory.get(name) || []).filter((time) => now - time < windowMs);
  if (recent.length >= limit) {
    rateHistory.set(name, recent);
    return false;
  }
  recent.push(now);
  rateHistory.set(name, recent);
  return true;
}

const els = {
  app: document.getElementById("app"),
  frame: document.getElementById("circleFrame"),
  loading: document.getElementById("loadingState"),
  loadingDetail: document.getElementById("loadingDetail"),
  passphrase: document.getElementById("passphraseState"),
  passphraseForm: document.getElementById("passphraseForm"),
  passphraseInput: document.getElementById("passphraseInput"),
  error: document.getElementById("errorState"),
  errorMessage: document.getElementById("errorMessage"),
  asset: document.getElementById("assetState"),
  assetBody: document.getElementById("assetBody"),
  retry: document.getElementById("retryButton"),
  switchNetwork: document.getElementById("switchNetworkButton"),
  copyUri: document.getElementById("copyUriButton"),
  addressForm: document.getElementById("addressForm"),
  addressInput: document.getElementById("addressInput"),
  title: document.getElementById("viewerTitle"),
  sealedChip: document.getElementById("sealedChip"),
  favicon: document.getElementById("appFavicon"),
  networkLabel: document.getElementById("networkLabel"),
  networkDot: document.getElementById("networkDot"),
  infoDialog: document.getElementById("infoDialog"),
  infoBody: document.getElementById("infoBody"),
  infoCopy: document.getElementById("infoCopy"),
  infoForget: document.getElementById("infoForgetPassphrase"),
  networkDialog: document.getElementById("networkDialog"),
  networkBody: document.getElementById("networkBody"),
  fullscreenExit: document.getElementById("fullscreenExit"),
  dappDialog: document.getElementById("dappDialog"),
  dappTitle: document.getElementById("dappTitle"),
  dappOrigin: document.getElementById("dappOrigin"),
  dappDescription: document.getElementById("dappDescription"),
  dappDetails: document.getElementById("dappDetails"),
  dappWalletRow: document.getElementById("dappWalletRow"),
  dappWallet: document.getElementById("dappWallet"),
  dappPinRow: document.getElementById("dappPinRow"),
  dappPin: document.getElementById("dappPin"),
  dappApprove: document.getElementById("dappApprove"),
  dappReject: document.getElementById("dappReject"),
  dappClose: document.getElementById("dappClose"),
  bookmarkButton: document.getElementById("bookmarkButton"),
  programChip: document.getElementById("programChip"),
  programChipText: document.getElementById("programChipText"),
  programDot: document.getElementById("programDot"),
  dappPinToggle: document.getElementById("dappPinToggle"),
  dockMode: document.getElementById("dockMode"),
  dockNetwork: document.getElementById("dockNetwork"),
  dockChain: document.getElementById("dockChain"),
  dockWallet: document.getElementById("dockWallet")
};

const state = {
  settings: null,
  network: null,
  circleId: "",
  host: "",
  path: "/index.html",
  display: "",
  mode: "public",
  info: null,
  passphrase: "",
  token: "",
  seq: 0,
  sandboxReady: false,
  sandboxPromise: null,
  stack: [],
  index: -1,
  pendingEntry: null,
  logs: [],
  assetCache: new Map(),
  objectUrls: [],
  dappResolve: null,
  pausedNoticeKey: ""
};

bindStaticControls();

init().catch((error) => {
  showError(error?.message || "Unable to start circlet.");
  setLoading(false);
});

async function init() {
  window.SynteqUI?.sidebarClose();
  document.addEventListener("DOMContentLoaded", () => window.SynteqUI?.sidebarClose());
  setTimeout(() => window.SynteqUI?.sidebarClose(), 80);
  try {
    if (localStorage.getItem("circlet:viewer:topbar") === "hidden") setTopbarHidden(true, false);
  } catch {}
  state.settings = await loadSettings();
  if (PARAMS.get("net") && PARAMS.get("net") !== state.settings.activeNetworkId) {
    state.settings = await setActiveNetwork(PARAMS.get("net"));
  }
  state.network = activeNetwork(state.settings);
  refreshNetworkUi();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes["circlet:settings:v1"]) {
      const next = normalizeSettings(changes["circlet:settings:v1"].newValue);
      state.settings = next;
      updateBookmarkUi();
      if (next.activeNetworkId !== state.network?.id) {
        state.network = activeNetwork(next);
        refreshNetworkUi();
        reloadCurrent();
      }
    }
  });

  const raw = PARAMS.get("raw");
  if (raw) {
    await openRaw(raw);
    return;
  }
  const circleId = PARAMS.get("circleId") || PARAMS.get("circle") || "";
  if (!circleId) {
    location.replace("home.html");
    return;
  }
  if (!/^oct[1-9A-HJ-NP-Za-km-z]{44}$/.test(circleId)) {
    throw new Error("The Circle address in this URL is invalid.");
  }
  const display = PARAMS.get("display") || circleUri(circleId, PARAMS.get("path") || "/index.html");
  const host = display.replace(/^oct:\/\//i, "").split(/[/?#]/)[0] || circleId;
  const entry = {
    circleId,
    host,
    path: normalizePath(PARAMS.get("path") || "/index.html"),
    display,
    mode: PARAMS.get("mode") || ""
  };
  await openEntry(entry, { push: true });
}

function bindStaticControls() {
  els.passphraseForm.addEventListener("submit", onPassphraseSubmit);
  els.retry.addEventListener("click", () => reloadCurrent());
  els.switchNetwork.addEventListener("click", () => {
    const other = state.settings.networks.find((network) => network.type !== state.network.type && (network.type === "mainnet" || network.type === "devnet"));
    if (other) switchNetwork(other.id);
    else showInfoDialog();
  });
  els.fullscreenExit.addEventListener("click", exitViewerFullscreen);
  els.dappReject.addEventListener("click", () => finishDappApproval(null));
  els.dappClose.addEventListener("click", () => finishDappApproval(null));
  els.dappApprove.addEventListener("click", approveDappRequest);
  els.dappPinToggle.addEventListener("click", () => {
    const visible = els.dappPin.type === "password";
    els.dappPin.type = visible ? "text" : "password";
    els.dappPinToggle.setAttribute("aria-pressed", String(visible));
    els.dappPinToggle.setAttribute("aria-label", visible ? "Hide PIN" : "Show PIN");
    els.dappPinToggle.title = visible ? "Hide PIN" : "Show PIN";
  });
  els.dappDialog.addEventListener("close", () => finishDappApproval(null));
  els.dappDialog.addEventListener("cancel", () => finishDappApproval(null));
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) setFullscreenClass(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("c-fullscreen") && !document.fullscreenElement) {
      event.preventDefault();
      exitViewerFullscreen();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      toggleViewerFullscreen();
    }
  });
  els.copyUri.addEventListener("click", () => copyText(state.display || "", "oct:// URL copied"));
  els.addressForm.addEventListener("submit", (event) => {
    event.preventDefault();
    navigateInput(els.addressInput.value);
  });
  els.addressInput.addEventListener("focus", () => els.addressInput.select());

  document.addEventListener("click", (event) => {
    const close = event.target.closest?.("[data-close-dialog]");
    if (close) {
      close.closest("dialog")?.close();
      return;
    }
    const action = event.target.closest?.("[data-action]")?.dataset.action;
    if (action) {
      event.preventDefault();
      handleAction(action);
      return;
    }
    const netButton = event.target.closest?.("[data-network]");
    if (netButton && netButton.closest(".c-netseg")) {
      switchNetwork(netButton.dataset.network);
      return;
    }
    if (event.target.closest?.("#infoCopy")) return;
  });

  els.infoCopy.addEventListener("click", () => copyText(state.circleId || "", "Circle address copied"));
  els.infoForget.addEventListener("click", async () => {
    await removeStoredPassphrase();
    state.passphrase = "";
    els.infoForget.hidden = true;
    SynteqToast("Passphrase removed from this session", "ok");
  });
  window.addEventListener("message", onWindowMessage);
}

function handleAction(action) {
  if (action === "back") goHistory(-1);
  else if (action === "forward") goHistory(1);
  else if (action === "reload") reloadCurrent();
  else if (action === "home") location.assign("home.html");
  else if (action === "info") showInfoDialog();
  else if (action === "network") showNetworkDialog();
  else if (action === "fullscreen") toggleViewerFullscreen();
  else if (action === "toggle-topbar") setTopbarHidden(!document.body.classList.contains("c-topbar-hidden"));
  else if (action === "bookmark") toggleBookmark();
  else if (action === "copy-uri") copyText(state.display || "", "Circle URI copied");
}

async function toggleBookmark() {
  if (!state.circleId) return;
  const key = circleBookmarkKey(state.network.id, state.circleId, state.path);
  if (findBookmark(state.settings, key)) {
    state.settings = await deleteBookmark(key);
    SynteqToast("Bookmark removed", "ok");
  } else {
    state.settings = await saveBookmark({
      kind: "circle",
      circleId: state.circleId,
      host: state.host,
      path: state.path,
      display: state.display,
      title: document.title.replace(/ · circlet$/i, "").trim() || state.host,
      networkId: state.network.id,
      mode: state.mode
    });
    SynteqToast("Bookmark saved", "ok");
  }
  updateBookmarkUi();
}

function updateBookmarkUi() {
  if (!els.bookmarkButton) return;
  const key = state.circleId ? circleBookmarkKey(state.network.id, state.circleId, state.path) : "";
  const saved = Boolean(key && findBookmark(state.settings, key));
  const disabled = !state.circleId || !els.error.hidden;
  els.bookmarkButton.disabled = disabled;
  els.bookmarkButton.setAttribute("aria-pressed", String(saved));
  const label = saved ? "Remove bookmark" : "Bookmark this Circle";
  els.bookmarkButton.title = label;
  els.bookmarkButton.setAttribute("aria-label", label);
  updateDockInfo();
}

function updateDockInfo() {
  if (!els.dockMode) return;
  const dapp = currentDapp();
  els.dockMode.textContent = state.mode === "sealed" ? "sealed" : "public";
  els.dockNetwork.textContent = state.network?.name || "—";
  els.dockChain.textContent = state.network?.chainId || "—";
  els.dockWallet.textContent = dapp?.address ? shortAddress(dapp.address, 10, 7) : "not connected";
}

async function updateProgramStatus() {
  if (!els.programChip) return;
  els.programChip.hidden = true;
  if (!state.circleId) return;
  const seq = state.seq;
  try {
    const infoResponse = await rpc(state.network, {
      jsonrpc: "2.0",
      id: 1,
      method: "octra_circleProgramInfo",
      params: [state.circleId]
    });
    if (seq !== state.seq) return;
    const programInfo = infoResponse?.result || infoResponse;
    if (!programInfo?.has_program) return;
    const view = await programView(state.network, state.circleId, "get_config_snapshot", []);
    if (seq !== state.seq) return;
    const text = typeof view === "string" ? view : String(view?.result ?? "");
    const fields = text.split("|");
    if (fields.length < 5) return;
    const paused = fields[4] === "1";
    els.programChip.hidden = false;
    els.programChip.classList.toggle("c-program-chip--paused", paused);
    els.programChip.classList.toggle("c-program-chip--online", !paused);
    els.programChipText.textContent = paused ? "program paused" : "program online";
    els.programDot.style.background = paused ? "var(--sq-status-warning)" : "var(--sq-status-running)";
    const key = `${state.network.id}:${state.circleId}:paused`;
    if (paused && state.pausedNoticeKey !== key) {
      state.pausedNoticeKey = key;
      SynteqToast("Program is paused", "warn");
    }
  } catch {
    if (seq === state.seq) els.programChip.hidden = true;
  }
}

function setFullscreenClass(active) {
  document.body.classList.toggle("c-fullscreen", active);
  els.app.classList.toggle("c-fullscreen", active);
}

async function enterViewerFullscreen() {
  setFullscreenClass(true);
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    }
  } catch {
    // CSS fullscreen still hides the viewer chrome when the API is denied.
  }
}

async function exitViewerFullscreen() {
  setFullscreenClass(false);
  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch {}
  }
}

function toggleViewerFullscreen() {
  if (document.body.classList.contains("c-fullscreen")) exitViewerFullscreen();
  else enterViewerFullscreen();
}

function setTopbarHidden(hidden, persist = true) {
  document.body.classList.toggle("c-topbar-hidden", hidden);
  document.querySelectorAll('[data-action="toggle-topbar"]').forEach((button) => {
    button.setAttribute("aria-pressed", String(hidden));
    const label = hidden ? "Show top bar" : "Hide top bar";
    button.title = label;
    button.setAttribute("aria-label", label);
  });
  if (persist) {
    try { localStorage.setItem("circlet:viewer:topbar", hidden ? "hidden" : "shown"); } catch {}
  }
}

function currentDapp() {
  return findDapp(state.settings, state.network.id, state.circleId);
}

function requireDapp() {
  const dapp = currentDapp();
  if (!dapp?.address) {
    const error = new Error("This Circle is not connected to a wallet.");
    error.code = 4100;
    throw error;
  }
  return dapp;
}

function normalizeRpc(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function assertWalletNetwork(wallet) {
  const current = normalizeRpc(wallet?.rpc_url);
  const matches = state.network.rpcUrls.some((url) => normalizeRpc(url) === current);
  if (!matches) {
    const error = new Error(`webcli wallet RPC does not match ${state.network.name}. Update it in Wallets -> Settings.`);
    error.code = 4901;
    throw error;
  }
}

async function connectDapp() {
  let status;
  try {
    status = await sendWebcli("status");
  } catch (error) {
    throw Object.assign(new Error("webcli is not reachable. Open Wallets to connect."), { code: 4900 });
  }
  const existing = currentDapp();
  const activeWallet = status.connected ? status.wallet : null;
  if (existing?.address && activeWallet?.address === existing.address) {
    return existing.address;
  }
  const wallets = Array.isArray(status.browser?.wallets) ? status.browser.wallets : [];
  if (!activeWallet && !wallets.length) {
    throw Object.assign(new Error("No wallet in webcli. Open Wallets to create or import one."), { code: 4100 });
  }
  const approval = await showDappApproval({
    title: "Connect wallet",
    description: "This Circle wants to view your account and request wallet actions. Your PIN is needed only if webcli is locked.",
    details: {
      Circle: state.display,
      Network: state.network.name,
      Wallet: activeWallet?.address || "select a wallet"
    },
    needsWallet: !activeWallet,
    needsPin: !activeWallet,
    wallets
  });
  if (!approval) {
    throw Object.assign(new Error("User rejected the connection."), { code: 4001 });
  }
  if (!activeWallet) {
    await sendWebcli("login", { address: approval.wallet, pin: approval.pin });
  }
  const nextStatus = await sendWebcli("status");
  const wallet = nextStatus.wallet;
  if (!wallet?.address) {
    throw Object.assign(new Error("Wallet is still locked."), { code: 4100 });
  }
  state.settings = await saveDapp({
    circleId: state.circleId,
    host: state.host,
    display: state.display,
    title: document.title.replace(/ · circlet$/i, "").trim() || state.host,
    networkId: state.network.id,
    address: wallet.address,
    permissions: ["accounts", "balance", "history", "call", "send", "program"]
  });
  updateDockInfo();
  broadcastDappEvent("accountsChanged", [wallet.address]);
  broadcastDappEvent("connect", { chainId: state.network.chainId || state.network.id });
  SynteqToast("Wallet connected", "ok");
  return wallet.address;
}

async function handleDappRequest(id, payload) {
  const method = String(payload.method || "");
  const params = payload.params;
  try {
    if (method === "octra_chainId" || method === "eth_chainId" || method === "octra_netVersion") {
      respond(id, true, state.network.chainId || state.network.id);
      return;
    }
    if (method === "octra_getNetwork") {
      respond(id, true, {
        chainId: state.network.chainId || state.network.id,
        name: state.network.name,
        rpc: state.network.rpcUrls[0] || ""
      });
      return;
    }
    if (method === "octra_networkInfo") {
      respond(id, true, {
        id: state.network.chainId || state.network.id,
        name: state.network.name,
        rpcUrl: state.network.rpcUrls[0] || "",
        explorerUrl: state.network.explorer || "",
        supportsPrivacy: true,
        isTestnet: state.network.type !== "mainnet"
      });
      return;
    }
    if (method === "octra_permissions") {
      const dapp = currentDapp();
      respond(id, true, dapp?.address
        ? ["read_address", "read_balance", "read_public_key", "contract_calls"]
        : []);
      return;
    }
    if (method === "octra_accounts" || method === "eth_accounts") {
      const dapp = currentDapp();
      respond(id, true, dapp?.address ? [dapp.address] : []);
      return;
    }
    if (method === "octra_requestAccounts" || method === "eth_requestAccounts" || method === "octra_connect") {
      const address = await connectDapp();
      respond(id, true, [address]);
      return;
    }
    if (method === "octra_disconnect") {
      const dapp = currentDapp();
      if (dapp) state.settings = await deleteDapp(dapp.id);
      broadcastDappEvent("disconnect", { code: 4900, message: "Wallet disconnected." });
      respond(id, true, true);
      return;
    }
    if (method === "octra_getBalance") {
      const dapp = requireDapp();
      const response = await rpc(state.network, { jsonrpc: "2.0", id: 1, method: "octra_balance", params: [dapp.address] });
      if (response?.error && !/sender not found/i.test(response.error.message || "")) throw new Error(response.error.message || "Balance lookup failed.");
      const result = response?.result;
      respond(id, true, String(result?.balance_raw ?? result?.balance ?? result?.public_balance ?? result ?? "0"));
      return;
    }
    if (method === "octra_getTransactionCount") {
      const dapp = requireDapp();
      const response = await rpc(state.network, { jsonrpc: "2.0", id: 1, method: "octra_balance", params: [dapp.address] });
      if (response?.error && !/sender not found/i.test(response.error.message || "")) throw new Error(response.error.message || "Nonce lookup failed.");
      respond(id, true, String(response?.result?.nonce ?? 0));
      return;
    }
    if (method === "octra_getHistory") {
      requireDapp();
      const history = await sendWebcli("request", { path: "/api/history?limit=50&offset=0", method: "GET" });
      respond(id, true, history);
      return;
    }
    if (method === "octra_call" || method === "octra_callProgramView" || method === "eth_call") {
      const call = Array.isArray(params)
        ? { address: params[0], method: params[1], params: params[2] }
        : (params || {});
      const address = call.address || call.to || call.circle_id || call.circleId;
      const callMethod = call.method || call.fn;
      if (!address || !callMethod) throw new Error("Contract address and method are required.");
      const result = await programView(state.network, address, callMethod, Array.isArray(call.params) ? call.params : []);
      respond(id, true, result);
      return;
    }
    if (method === "octra_sendTransaction" || method === "eth_sendTransaction") {
      const dapp = requireDapp();
      const tx = Array.isArray(params) ? params[0] : (params || {});
      if (!tx.to || tx.amount == null) throw new Error("Transaction recipient and amount are required.");
      const status = await sendWebcli("status").catch(() => ({}));
      const activeWallet = status.connected ? status.wallet : null;
      const approval = await showDappApproval({
        title: "Send transaction",
        description: "Approve this transaction. Your PIN authorizes webcli to sign and submit it.",
        details: {
          From: activeWallet?.address || dapp.address,
          To: tx.to,
          Amount: String(tx.amount),
          Message: tx.message || "",
          Network: state.network.name
        },
        needsWallet: !activeWallet,
        needsPin: true,
        wallets: status.browser?.wallets || []
      });
      if (!approval) throw Object.assign(new Error("User rejected the transaction."), { code: 4001 });
      if (!activeWallet) await sendWebcli("login", { address: approval.wallet, pin: approval.pin });
      const nextStatus = await sendWebcli("status");
      const wallet = nextStatus.wallet;
      if (!wallet?.address) throw Object.assign(new Error("Wallet is still locked."), { code: 4100 });
      assertWalletNetwork(wallet);
      if (dapp.address && wallet.address !== dapp.address) {
        throw Object.assign(new Error("The active webcli wallet changed. Reconnect this Circle."), { code: 4100 });
      }
      const result = await sendWebcli("request", {
        path: "/api/send",
        method: "POST",
        body: {
          to: tx.to,
          amount: String(tx.amount),
          message: tx.message || "",
          pin: approval.pin,
          expected_wallet: wallet.address,
          expected_generation: wallet.generation
        }
      });
      respond(id, true, result);
      return;
    }
    if (method === "octra_callProgram" || method === "octra_sendTransactionProgram") {
      const dapp = requireDapp();
      const call = Array.isArray(params) ? params[0] : (params || {});
      const callMethod = call.method || call.fn;
      if (!callMethod) throw new Error("Program method is required.");
      const status = await sendWebcli("status").catch(() => ({}));
      const activeWallet = status.connected ? status.wallet : null;
      const approval = await showDappApproval({
        title: "Execute program call",
        description: "Approve this program call. Your PIN authorizes webcli to sign and submit it.",
        details: {
          Circle: call.circle_id || call.address || state.circleId,
          Method: callMethod,
          Params: call.params || [],
          Amount: call.amount || "0",
          Network: state.network.name
        },
        needsWallet: !activeWallet,
        needsPin: true,
        wallets: status.browser?.wallets || []
      });
      if (!approval) throw Object.assign(new Error("User rejected the program call."), { code: 4001 });
      if (!activeWallet) await sendWebcli("login", { address: approval.wallet, pin: approval.pin });
      const wallet = (await sendWebcli("status")).wallet;
      if (!wallet) throw Object.assign(new Error("Wallet is still locked."), { code: 4100 });
      assertWalletNetwork(wallet);
      if (dapp.address && wallet.address !== dapp.address) {
        throw Object.assign(new Error("The active webcli wallet changed. Reconnect this Circle."), { code: 4100 });
      }
      const result = await sendWebcli("request", {
        path: "/api/program/call",
        method: "POST",
        body: {
          circle_id: call.circle_id || (call.address ? "" : state.circleId),
          address: call.address || "",
          method: callMethod,
          params: Array.isArray(call.params) ? call.params : [],
          amount: String(call.amount || "0"),
          pin: approval.pin,
          expected_wallet: wallet.address,
          expected_generation: wallet.generation
        }
      });
      respond(id, true, result);
      return;
    }
    if (method === "octra_signMessage" || method === "personal_sign") {
      throw Object.assign(new Error("Message signing is not available in webcli yet."), { code: 4200 });
    }
    if (method === "wallet_getPermissions") {
      const dapp = currentDapp();
      respond(id, true, dapp?.address ? [{ parentCapability: "octra_accounts" }] : []);
      return;
    }
    if (method === "wallet_requestPermissions") {
      const address = await connectDapp();
      respond(id, true, [{ parentCapability: "octra_accounts", address }]);
      return;
    }
    throw Object.assign(new Error(`Unsupported provider method: ${method}`), { code: 4200 });
  } catch (error) {
    const raw = error?.message || "Wallet request failed.";
    const message = /pin|passphrase|refus|incorrect|wrong/i.test(raw) ? "PIN refused" : raw;
    SynteqToast(message, "err");
    respond(id, false, null, message, error?.code || -32603);
  }
}

function showDappApproval(options) {
  return new Promise((resolve) => {
    state.dappResolve = resolve;
    state.dappNeedsPin = Boolean(options.needsPin);
    state.dappNeedsWallet = Boolean(options.needsWallet);
    els.dappTitle.textContent = options.title || "Wallet request";
    els.dappOrigin.textContent = state.display;
    els.dappDescription.textContent = options.description || "";
    els.dappDetails.textContent = JSON.stringify(options.details || {}, null, 2);
    els.dappWalletRow.hidden = !options.needsWallet;
    els.dappWallet.replaceChildren();
    for (const wallet of options.wallets || []) {
      const option = document.createElement("option");
      option.value = wallet.addr;
      option.textContent = `${wallet.name || "wallet"} · ${wallet.addr}`;
      els.dappWallet.append(option);
    }
    if (!els.dappWallet.options.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No wallet available";
      els.dappWallet.append(option);
    }
    els.dappPinRow.hidden = !options.needsPin;
    els.dappPin.value = "";
    els.dappDialog.showModal();
    setTimeout(() => {
      if (options.needsWallet) els.dappWallet.focus();
      else if (options.needsPin) els.dappPin.focus();
      else els.dappApprove.focus();
    }, 40);
  });
}

function approveDappRequest() {
  if (!state.dappResolve) return;
  const pin = els.dappPin.value;
  const wallet = els.dappWallet.value;
  if (state.dappNeedsWallet && !wallet) return SynteqToast("Select a wallet", "warn");
  if (state.dappNeedsPin && !pin) {
    els.dappPin.focus();
    return SynteqToast("PIN is required", "warn");
  }
  finishDappApproval({ wallet, pin });
}

function finishDappApproval(value) {
  const resolve = state.dappResolve;
  state.dappResolve = null;
  if (els.dappDialog.open) els.dappDialog.close();
  if (resolve) resolve(value);
}

function broadcastDappEvent(event, data) {
  if (!state.token) return;
  try {
    els.frame.contentWindow.postMessage({
      source: "circlet-dapp-event",
      token: state.token,
      event,
      data
    }, "*");
  } catch {}
}

function SynteqToast(message, kind) {
  try {
    window.SynteqUI?.toast(message, { kind: kind || "info" });
  } catch {
    // Toast failures must never stop navigation.
  }
}

async function sendWebcli(action, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type: `circlet:webcli:${action}`, ...payload });
  if (!response?.ok) {
    const error = new Error(response?.error || "webcli request failed");
    error.code = response?.code || "";
    error.status = response?.status || 0;
    throw error;
  }
  return response.data;
}

function setLoading(active) {
  try {
    window.SynteqUI?.setLoading(Boolean(active));
  } catch {}
}

function refreshNetworkUi() {
  const network = state.network || activeNetwork(state.settings);
  els.networkLabel.textContent = network?.name || "Octra";
  document.querySelectorAll(".c-netseg [data-network]").forEach((button) => {
    const target = state.settings.networks.find((entry) => entry.id === button.dataset.network || entry.type === button.dataset.network) || null;
    const isActive = Boolean(target && target.id === network.id);
    button.classList.toggle("sq-seg__btn--active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

async function switchNetwork(networkId) {
  if (!networkId || networkId === state.network.id) return;
  state.settings = await setActiveNetwork(networkId);
  state.network = activeNetwork(state.settings);
  refreshNetworkUi();
  reloadCurrent();
}

function reloadCurrent() {
  if (state.circleId) {
    openEntry(
      {
        circleId: state.circleId,
        host: state.host,
        path: state.path,
        display: state.display,
        mode: state.mode
      },
      { push: false, passphrase: state.passphrase }
    );
  } else {
    location.reload();
  }
}

async function openRaw(raw) {
  setLoading(true);
  showState("loading");
  els.loadingDetail.textContent = "Resolving the Octra destination.";
  try {
    const target = await resolveTarget(raw, state.settings, { network: state.network });
    if (target.kind === "web") {
      await chrome.tabs.create({ url: target.url });
      showError("This destination is a regular website. It was opened in a new tab.");
      return;
    }
    if (target.kind === "account") {
      await chrome.tabs.create({ url: target.explorerUrl });
      showError("This address is not a Circle application. It was opened in the explorer.");
      return;
    }
    await openEntry(
      { circleId: target.circleId, host: target.host, path: target.path, display: target.display, mode: target.mode, info: target.info },
      { push: true }
    );
  } catch (error) {
    showError(error?.message || "Unable to resolve the destination.");
  } finally {
    setLoading(false);
  }
}

async function navigateInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return;
  if (/^https?:\/\//i.test(raw)) {
    await chrome.tabs.create({ url: raw });
    els.addressInput.value = displayValue(state.display);
    return;
  }
  const spec = parseTarget(raw);
  if (!spec) {
    SynteqToast("Enter an Octra address, a .oct name, or oct:// URI", "warn");
    els.addressInput.value = displayValue(state.display);
    return;
  }
  setLoading(true);
  els.loadingDetail.textContent = "Resolving the Octra destination.";
  showState("loading");
  try {
    const target = await resolveTarget(raw, state.settings, { network: state.network });
    if (target.kind === "web") {
      await chrome.tabs.create({ url: target.url });
      showState(state.circleId ? "frame" : "error");
      return;
    }
    if (target.kind === "account") {
      await chrome.tabs.create({ url: target.explorerUrl });
      showError("This address is not a Circle application. It was opened in the explorer.");
      return;
    }
    await openEntry(
      { circleId: target.circleId, host: target.host, path: target.path, display: target.display, mode: target.mode, info: target.info },
      { push: true }
    );
  } catch (error) {
    showError(error?.message || "Unable to resolve the destination.");
  } finally {
    setLoading(false);
  }
}

async function openEntry(entry, options = {}) {
  const seq = ++state.seq;
  const passphrase = options.passphrase !== undefined ? options.passphrase : state.passphrase;
  const previousCircle = state.circleId;
  if (previousCircle && previousCircle !== entry.circleId) {
    state.assetCache.clear();
    state.passphrase = "";
  }
  if (options.passphrase !== undefined && options.passphrase !== state.passphrase) {
    state.assetCache.clear();
  }
  state.pendingEntry = entry;
  setLoading(true);
  showState("loading");
  els.loadingDetail.textContent = "Fetching Circle metadata from the active Octra RPC.";
  try {
    const info = entry.info || (await circleInfo(state.network, entry.circleId));
    const mode = isSealedInfo(info) ? "sealed" : "public";
    let unlock = passphrase;
    if (mode === "sealed" && !unlock) {
      unlock = await getStoredPassphrase(entry.circleId);
    }
    if (mode === "sealed" && !unlock) {
      state.circleId = entry.circleId;
      state.host = entry.host || entry.circleId;
      state.path = normalizePath(entry.path);
      state.display = entry.display || circleUri(state.host, state.path);
      state.mode = "sealed";
      state.info = info;
      state.passphrase = "";
      updateAddressBar();
      updateBookmarkUi();
      updateProgramStatus();
      els.sealedChip.hidden = false;
      els.passphraseInput.value = "";
      showState("passphrase");
      setTimeout(() => els.passphraseInput.focus(), 50);
      return;
    }

    state.circleId = entry.circleId;
    state.host = entry.host || entry.circleId;
    state.path = normalizePath(entry.path || "/index.html");
    state.display = entry.display || circleUri(state.host, state.path);
    state.mode = mode;
    state.info = info;
    state.passphrase = unlock || "";
    state.token = crypto.randomUUID();
    els.sealedChip.hidden = mode !== "sealed";
    updateAddressBar();
    updateBookmarkUi();
    updateProgramStatus();
    if (unlock) await storePassphrase(entry.circleId, unlock);

    els.loadingDetail.textContent = "Fetching Circle resources.";
    const asset = await loadCircleAsset(entry.circleId, state.path, { force: false });
    if (seq !== state.seq) return;

    if (isHtmlContentType(asset.contentType)) {
      const indexAsset =
        normalizePath(state.path) === "/index.html"
          ? asset
          : await loadCircleAsset(entry.circleId, "/index.html").catch(() => null);
      const metadata = indexAsset || asset;
      const appTitle = extractHtmlTitle(metadata) || extractHtmlTitle(asset) || state.host;
      const favicon = await resolveFavicon(metadata).catch(() => null);
      applyMeta(appTitle, favicon);
      const storage = await storageSnapshot(entry.circleId);
      els.loadingDetail.textContent = "Reconstructing scripts, styles and media.";
      const built = await buildDocument({
        html: bytesToText(asset.body),
        circleId: entry.circleId,
        host: state.host,
        path: state.path,
        display: state.display,
        network: state.network,
        info,
        mode,
        token: state.token,
        settings: state.settings,
        storage,
        remoteAllowed: Boolean(state.settings.allowRemoteNetwork) && mode === "public",
        loadAsset: (circleId, assetPath) => loadCircleAsset(circleId, assetPath),
        fetchRemote: (url, maxBytes, kind) => fetchRemote(url, maxBytes, kind)
      });
      if (seq !== state.seq) return;
      if (built.warnings?.length) {
        state.logs.push(...built.warnings.slice(0, 20).map((message) => ({ level: "warn", message })));
      }
      await renderInSandbox(built.html, state.token);
    } else {
      renderSimpleAsset(asset, state.host);
      showState("asset");
    }

    if (seq !== state.seq) return;
    updateHistoryBar();
    if (options.push !== false) pushHistory(entry);
    await addRecent({
      circleId: entry.circleId,
      path: state.path,
      display: state.display,
      title: document.title.replace(/ · circlet$/i, ""),
      networkId: state.network.id,
      mode
    });
    const status = await nodeStatus(state.network).catch(() => null);
    if (status && status.latencyMs != null) {
      els.networkDot.title = `${state.network.name} · ${status.latencyMs} ms · epoch ${status.epoch}`;
    }
  } catch (error) {
    if (seq !== state.seq) return;
    state.assetCache.clear();
    if (state.mode === "sealed") {
      state.passphrase = "";
      await removeStoredPassphrase(entry.circleId);
    }
    const message = isCircleNotFound(error)
      ? `${error?.message || "Circle not found"} on ${state.network.name}. Try switching network.`
      : error?.message || "Unable to open Circle.";
    showError(message);
  } finally {
    if (seq === state.seq) setLoading(false);
  }
}

async function loadCircleAsset(circleId, rawPath, options = {}) {
  const path = normalizePath(rawPath);
  const key = `${circleId}:${path}`;
  if (!options.force && state.assetCache.has(key)) return state.assetCache.get(key);
  const pending = (async () => {
    let asset;
    if (circleId === state.circleId) {
      if (state.mode === "sealed") {
        if (!state.passphrase) throw new Error("Open the sealed Circle before reading its resources.");
        asset = await fetchSealedCircleAsset(state.network, circleId, path, state.passphrase);
      } else {
        asset = await fetchCircleAsset(state.network, circleId, path);
      }
    } else {
      if (state.mode === "sealed") {
        throw new Error("Sealed Circles cannot load resources from another Circle.");
      }
      const info = await circleInfo(state.network, circleId);
      if (isSealedInfo(info)) {
        throw new Error("Open the sealed Circle directly before reading its resources.");
      }
      asset = await fetchCircleAsset(state.network, circleId, path);
    }
    if (!asset?.body || asset.body.byteLength > MAX_ASSET_BYTES) {
      throw new Error("Circle resource exceeds the 32 MB limit.");
    }
    return asset;
  })();
  state.assetCache.set(key, pending);
  if (state.assetCache.size > 128) {
    const keep = state.assetCache.get(key);
    state.assetCache.clear();
    state.assetCache.set(key, keep);
  }
  try {
    return await pending;
  } catch (error) {
    state.assetCache.delete(key);
    throw error;
  }
}

async function fetchRemote(url, maxBytes, kind) {
  if (!state.settings.allowRemoteNetwork || state.mode === "sealed") {
    throw new Error("Remote network access is disabled.");
  }
  if (!isSafeRemoteUrl(url)) throw new Error("Remote asset URL is not allowed.");
  const response = await fetch(url, {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    redirect: "error",
    cache: "force-cache"
  });
  if (!response.ok) throw new Error(`Remote asset HTTP ${response.status}`);
  const limit = Number(maxBytes) || 8 * 1024 * 1024;
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > limit) throw new Error("Remote asset is too large.");
  let buffer;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => {});
        throw new Error("Remote asset is too large.");
      }
      chunks.push(value);
    }
    buffer = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } else {
    buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > limit) throw new Error("Remote asset is too large.");
  }
  return kind === "text" ? new TextDecoder("utf-8").decode(buffer) : buffer;
}

async function resolveFavicon(asset) {
  if (!asset || !isHtmlContentType(asset.contentType)) return null;
  const doc = new DOMParser().parseFromString(bytesToText(asset.body), "text/html");
  const link = [...doc.querySelectorAll("link[rel][href]")].find((node) =>
    /(?:^|\s)(?:icon|shortcut|apple-touch-icon)(?:\s|$)/i.test(node.getAttribute("rel") || "")
  );
  const href = link?.getAttribute("href")?.trim() || "";
  if (!href) return null;
  if (href.startsWith("data:")) return href.length <= 2_000_000 ? href : null;
  if (/^https:\/\//i.test(href)) return isSafeRemoteUrl(href) ? href : null;
  if (href.startsWith("//")) {
    const secure = `https:${href}`;
    return isSafeRemoteUrl(secure) ? secure : null;
  }
  if (/^https?:/i.test(href)) return null;
  try {
    const directory = state.path.replace(/[^/]*$/, "");
    const assetPath = normalizePath(new URL(href, `oct://${state.circleId}${directory}`).pathname);
    const icon = await loadCircleAsset(state.circleId, assetPath);
    return bytesToDataUrl(icon.contentType, icon.body);
  } catch {
    return null;
  }
}

function applyMeta(title, favicon) {
  const cleanTitle = String(title || state.host || state.circleId).slice(0, 120);
  document.title = `${cleanTitle} · circlet`;
  els.title.textContent = cleanTitle;
  els.favicon.href = favicon || DEFAULT_FAVICON;
  els.favicon.removeAttribute("type");
  updateBookmarkUi();
}

function resetMetaForError() {
  document.title = "circlet";
  els.title.textContent = "Circle unavailable";
  els.favicon.href = DEFAULT_FAVICON;
}

function updateAddressBar() {
  els.addressInput.value = displayValue(state.display);
  els.addressInput.title = state.display;
}

function displayValue(display) {
  return String(display || "").replace(/^oct:\/\//i, "");
}

async function renderInSandbox(html, token) {
  await ensureSandbox();
  showState("frame");
  try {
    els.frame.contentWindow.postMessage({ source: "circlet-render", token, html }, "*");
  } catch {
    throw new Error("Unable to hand the Circle document to the sandbox.");
  }
  setTimeout(() => {
    if (state.token === token && !els.frame.hidden) setLoading(false);
  }, 1200);
}

function ensureSandbox() {
  if (state.sandboxReady) return Promise.resolve();
  if (state.sandboxPromise) return state.sandboxPromise;
  state.sandboxPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Sandbox failed to load.")), 10000);
    const onLoad = () => {
      clearTimeout(timer);
      state.sandboxReady = true;
      els.frame.removeEventListener("load", onLoad);
      resolve();
    };
    els.frame.addEventListener("load", onLoad);
    els.frame.src = SANDBOX_URL;
  }).finally(() => {
    state.sandboxPromise = null;
  });
  return state.sandboxPromise;
}

function renderSimpleAsset(asset, label) {
  els.assetBody.replaceChildren();
  const title = document.createElement("div");
  title.className = "c-state__title";
  title.textContent = label || "Circle resource";
  const meta = document.createElement("div");
  meta.className = "c-state__body c-mono";
  meta.textContent = `${asset.contentType || "application/octet-stream"} · ${formatBytes(asset.body.byteLength)}`;
  els.assetBody.append(title, meta);

  if (String(asset.contentType).startsWith("image/")) {
    const image = document.createElement("img");
    image.alt = "Circle resource";
    image.style.maxWidth = "100%";
    image.style.maxHeight = "60vh";
    image.src = bytesToDataUrl(asset.contentType, asset.body);
    els.assetBody.append(image);
  } else if (isTextContentType(asset.contentType)) {
    const pre = document.createElement("pre");
    pre.className = "sq-code__pre c-break";
    pre.style.maxHeight = "50vh";
    pre.style.overflow = "auto";
    pre.style.width = "100%";
    pre.style.textAlign = "left";
    pre.textContent = bytesToText(asset.body).slice(0, 200000);
    els.assetBody.append(pre);
  } else {
    const note = document.createElement("div");
    note.className = "c-state__body";
    note.textContent = "This resource is not HTML, text, or an image. Download it to open it with a local application.";
    els.assetBody.append(note);
  }

  const actions = document.createElement("div");
  actions.className = "c-state__actions";
  const download = document.createElement("button");
  download.type = "button";
  download.className = "sq-btn sq-btn--primary";
  download.textContent = "Download resource";
  download.addEventListener("click", () => downloadSingleAsset(asset, label));
  actions.append(download);
  els.assetBody.append(actions);
}

async function downloadSingleAsset(asset, label) {
  const fileName = label && label !== state.circleId ? `${label.replace(/[^a-z0-9._-]+/gi, "-")}${extensionFor(asset)}` : `circle-resource${extensionFor(asset)}`;
  const url = URL.createObjectURL(new Blob([asset.body], { type: asset.contentType }));
  state.objectUrls.push(url);
  try {
    await chrome.downloads.download({ url, filename: fileName, saveAs: true });
    SynteqToast("Download started", "ok");
  } catch (error) {
    SynteqToast(error?.message || "Download failed", "err");
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

function extensionFor(asset) {
  const type = String(asset.contentType || "");
  if (type.includes("pdf")) return ".pdf";
  if (type.includes("zip")) return ".zip";
  if (type.includes("json")) return ".json";
  if (type.includes("html")) return ".html";
  if (type.includes("svg")) return ".svg";
  if (type.includes("png")) return ".png";
  if (type.includes("jpeg")) return ".jpg";
  return ".bin";
}

function showInfoDialog() {
  els.infoBody.replaceChildren();
  if (!state.circleId) {
    els.infoBody.append(note("No Circle is open."));
    return;
  }
  const kv = document.createElement("div");
  kv.className = "sq-kv";
  kv.append(
    kvRow("URI", state.display, true),
    kvRow("Circle ID", state.circleId, true),
    kvRow("Network", `${state.network.name} (${state.network.type})`),
    kvRow("RPC", state.network.rpcUrls[0] || "not configured", true),
    kvRow("Mode", state.mode === "sealed" ? "sealed" : "public"),
    kvRow("Owner", state.info?.owner || "unknown", true),
    kvRow("Path", state.path, true)
  );
  els.infoBody.append(kv);

  if (state.info?.owner) {
    const ownerRow = document.createElement("div");
    ownerRow.className = "c-row c-row--between";
    ownerRow.style.marginTop = "var(--sq-space-4)";
    const explorer = explorerAddressUrl(state.network.explorer, state.info.owner);
    if (explorer) {
      const link = document.createElement("a");
      link.className = "sq-btn sq-btn--ghost";
      link.href = explorer;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Owner in explorer";
      ownerRow.append(link);
    }
    els.infoBody.append(ownerRow);
  }

  if (state.mode === "sealed") {
    els.infoForget.hidden = false;
  } else {
    els.infoForget.hidden = true;
  }
  if (state.logs.length) {
    const heading = document.createElement("div");
    heading.className = "sq-section__title";
    heading.style.marginTop = "var(--sq-space-4)";
    heading.textContent = "Sandbox warnings";
    const log = document.createElement("div");
    log.className = "sq-log sq-log--scroll sq-log--bordered";
    log.setAttribute("role", "log");
    for (const entry of state.logs.slice(-12)) {
      const row = document.createElement("div");
      row.className = `sq-log__row${entry.level === "error" ? " sq-log__row--error" : " sq-log__row--warn"}`;
      const level = document.createElement("span");
      level.className = `sq-log__level${entry.level === "error" ? " sq-log__level--error" : " sq-log__level--warn"}`;
      level.textContent = entry.level === "error" ? "ERR" : "WARN";
      const message = document.createElement("span");
      message.className = "sq-log__msg c-break";
      message.textContent = entry.message;
      row.append(level, message);
      log.append(row);
    }
    els.infoBody.append(heading, log);
  }
  els.infoDialog.showModal();
}

function showNetworkDialog() {
  els.networkBody.replaceChildren();
  const list = document.createElement("div");
  list.className = "c-list";
  for (const network of state.settings.networks) {
    const row = document.createElement("div");
    row.className = "c-list__row";
    const copy = document.createElement("div");
    copy.className = "c-col";
    const title = document.createElement("span");
    title.className = "c-list__title";
    title.textContent = network.name;
    const meta = document.createElement("span");
    meta.className = "c-list__meta c-mono";
    meta.textContent = `${network.type} · ${network.rpcUrls.join(" → ")}`;
    copy.append(title, meta);
    const button = document.createElement("button");
    button.type = "button";
    button.className = network.id === state.network.id ? "sq-btn sq-btn--brand" : "sq-btn";
    button.textContent = network.id === state.network.id ? "Active" : "Use";
    button.disabled = network.id === state.network.id;
    button.addEventListener("click", async () => {
      els.networkDialog.close();
      await switchNetwork(network.id);
    });
    row.append(copy, button);
    list.append(row);
  }
  els.networkBody.append(list);
  els.networkDialog.showModal();
}

function kvRow(label, value, mono) {
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

function note(text) {
  const node = document.createElement("div");
  node.className = "c-state__body";
  node.textContent = text;
  return node;
}

async function onPassphraseSubmit(event) {
  event.preventDefault();
  const passphrase = els.passphraseInput.value.trim();
  if (!passphrase) {
    els.passphraseInput.focus();
    return;
  }
  const entry = state.pendingEntry || {
    circleId: state.circleId,
    host: state.host,
    path: state.path,
    display: state.display,
    mode: "sealed",
    info: state.info
  };
  await openEntry(entry, { push: true, passphrase });
}

function showState(name) {
  els.loading.hidden = name !== "loading";
  els.passphrase.hidden = name !== "passphrase";
  els.error.hidden = name !== "error";
  els.asset.hidden = name !== "asset";
  els.frame.hidden = name !== "frame";
}

function showError(message) {
  resetMetaForError();
  els.errorMessage.textContent = message || "Unknown error";
  showState("error");
  setLoading(false);
  updateBookmarkUi();
  if (els.programChip) els.programChip.hidden = true;
}

function updateHistoryBar() {
  const canBack = state.index > 0;
  const canForward = state.index >= 0 && state.index < state.stack.length - 1;
  document.querySelectorAll('[data-action="back"]').forEach((button) => {
    button.disabled = !canBack;
  });
  document.querySelectorAll('[data-action="forward"]').forEach((button) => {
    button.disabled = !canForward;
  });
}

function pushHistory(entry) {
  const item = {
    circleId: entry.circleId,
    host: entry.host || entry.circleId,
    path: normalizePath(entry.path),
    display: entry.display || circleUri(entry.host || entry.circleId, entry.path),
    mode: entry.mode || state.mode
  };
  const current = state.stack[state.index];
  if (current && current.circleId === item.circleId && current.path === item.path) {
    state.stack[state.index] = item;
  } else {
    state.stack = state.stack.slice(0, state.index + 1);
    state.stack.push(item);
    state.index = state.stack.length - 1;
  }
  updateHistoryBar();
  replaceViewerUrl(item);
}

function replaceViewerUrl(item) {
  try {
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("circleId", item.circleId);
    url.searchParams.set("path", item.path);
    url.searchParams.set("display", item.display);
    url.searchParams.set("mode", item.mode);
    url.searchParams.set("net", state.network.id);
    history.replaceState(null, "", url.href);
  } catch {}
}

function goHistory(delta) {
  const next = state.index + delta;
  if (next < 0 || next >= state.stack.length) return;
  state.index = next;
  const item = state.stack[next];
  openEntry(item, { push: false });
}

async function onWindowMessage(event) {
  if (event.source !== els.frame.contentWindow) return;
  const message = event.data;
  if (!message || typeof message !== "object") return;
  if (message.source === "circlet-frame") {
    if (message.token !== state.token) return;
    if (message.type === "ready") {
      showState("frame");
      setLoading(false);
      const dapp = currentDapp();
      if (dapp?.address) {
        setTimeout(() => {
          broadcastDappEvent("accountsChanged", [dapp.address]);
          broadcastDappEvent("connect", { chainId: state.network.chainId || state.network.id });
        }, 50);
      }
      return;
    }
    if (message.type === "meta") {
      if (message.title) applyMeta(message.title, message.favicon || null);
      return;
    }
    return;
  }
  if (message.source === "circlet-storage") {
    if (message.token !== state.token) return;
    if (!allowRate("storage", 40, 5000)) return;
    persistStorage(message).catch(() => {});
    return;
  }
  if (message.source === "circlet-navigate") {
    if (message.token !== state.token) return;
    const href = String(message.href || "");
    if (!/^oct:\/\//i.test(href)) return;
    if (!allowRate("navigate", 6, 5000)) return;
    navigateInput(href);
    return;
  }
  if (message.source === "circlet-open") {
    if (message.token !== state.token) return;
    const href = String(message.href || "");
    if (!isSafeRemoteUrl(href)) return;
    if (!allowRate("open", 4, 5000)) return;
    chrome.tabs.create({ url: href }).catch(() => {});
    return;
  }
  if (message.source === "circlet-log") {
    if (message.token !== state.token) return;
    if (!allowRate("log", 20, 5000)) return;
    const entry = { level: message.level === "error" ? "error" : "warn", message: String(message.message || "").slice(0, 2000) };
    if (entry.message) {
      state.logs.push(entry);
      if (state.logs.length > 30) state.logs.shift();
      console.warn("[circle]", entry.message);
    }
    return;
  }
  if (message.source !== "circlet-request") return;
  if (message.token !== state.token) return;
  const id = message.id;
  if (!id) return;
  try {
    if (message.kind === "asset") {
      await handleAssetRequest(id, message.payload || {});
    } else if (message.kind === "rpc") {
      await handleRpcRequest(id, message.payload || {});
    } else if (message.kind === "bridge") {
      await handleBridgeRequest(id, message.payload || {});
    } else if (message.kind === "clipboard") {
      await writeClipboard(String(message.payload?.text ?? ""));
      respond(id, true, true);
    } else if (message.kind === "dapp") {
      await handleDappRequest(id, message.payload || {});
    } else if (message.kind === "download") {
      await handleDownloadRequest(id, message.payload || {});
    } else {
      respond(id, false, null, `Unsupported request: ${message.kind}`, 4200);
    }
  } catch (error) {
    respond(id, false, null, error?.message || "Circle request failed.", Number(error?.code) || -32000);
  }
}

function respond(id, ok, result, error, code) {
  try {
    const payload = {
      source: "circlet-response",
      token: state.token,
      id,
      ok: Boolean(ok),
      result: ok ? result : undefined,
      error: ok ? undefined : String(error || "Request failed"),
      code: ok ? undefined : Number(code || -32000)
    };
    const transfer = [];
    if (ok && result && result.body instanceof ArrayBuffer) transfer.push(result.body);
    els.frame.contentWindow.postMessage(payload, "*", transfer);
  } catch {}
}

async function handleAssetRequest(id, payload) {
  const circleId = String(payload.circleId || state.circleId);
  if (!/^oct[1-9A-HJ-NP-Za-km-z]{44}$/.test(circleId)) throw new Error("Invalid Circle asset target.");
  const path = normalizePath(payload.path || "/index.html");
  const asset = await loadCircleAsset(circleId, path);
  const body = asset.body.slice().buffer;
  respond(id, true, {
    circleId: asset.circleId || circleId,
    path: asset.path || path,
    contentType: asset.contentType || "application/octet-stream",
    sizeBytes: asset.sizeBytes || asset.body.byteLength,
    body
  });
}

async function handleRpcRequest(id, payload) {
  let request;
  try {
    request = JSON.parse(String(payload.body || "null"));
  } catch {
    throw new Error("Circle sent invalid JSON-RPC.");
  }
  const response = await forwardCircleRpcPayload(state.network, request);
  respond(id, true, JSON.stringify(response));
}

async function handleBridgeRequest(id, payload) {
  const method = String(payload.method || "");
  const input = payload.payload && typeof payload.payload === "object" ? payload.payload : {};
  if (method === "circle.context") {
    respond(id, true, runtimeContext());
    return;
  }
  if (method === "program.info") {
    const response = await forwardCircleRpcPayload(state.network, {
      jsonrpc: "2.0",
      id: 1,
      method: "octra_circleProgramInfo",
      params: [state.circleId]
    });
    respond(id, true, response.error ? state.info : response.result ?? state.info);
    return;
  }
  if (method === "program.view") {
    const result = await programView(state.network, state.circleId, input.method, Array.isArray(input.params) ? input.params : []);
    respond(id, true, result);
    return;
  }
  if (method === "rpc") {
    const response = await forwardCircleRpcPayload(state.network, input);
    respond(id, true, response);
    return;
  }
  if (method === "circle.asset") {
    const asset = await loadCircleAsset(state.circleId, input.path || "/index.html");
    respond(id, true, {
      circle_id: asset.circleId,
      canonical_path: asset.path,
      content_type: asset.contentType,
      size_bytes: String(asset.body.byteLength),
      body_b64: bytesToBase64(asset.body)
    });
    return;
  }
  if (method === "circle.context.info") {
    respond(id, true, state.info || {});
    return;
  }
  throw Object.assign(new Error(`Unsupported Circle runtime method: ${method}`), { code: 4200 });
}

function runtimeContext() {
  return {
    circle_id: state.circleId,
    path: state.path,
    uri: circleUri(state.host, state.path),
    display: state.display,
    network: state.network?.id || "",
    network_name: state.network?.name || "",
    mode: state.mode,
    runtime: state.info?.runtime || null,
    owner: state.info?.owner || null,
    privacy_class: state.info?.privacy_class || null,
    resource_mode: state.info?.resource_mode || null,
    browser_mode: state.info?.browser_mode || null
  };
}

async function handleDownloadRequest(id, payload) {
  if (!allowRate("download", 2, 60000)) throw new Error("Too many downloads. Try again in a minute.");
  const resources = Array.isArray(payload.resources) ? payload.resources : [];
  if (!resources.length || resources.length > 32) throw new Error("Download has an invalid number of parts.");
  const fileName = safeFileName(payload.fileName);
  const mimeType = safeMime(payload.mimeType, fileName);
  const chunks = [];
  let total = 0;
  for (let index = 0; index < resources.length; index += 1) {
    const resource = resources[index];
    const circleId = String(resource?.circleId || state.circleId);
    if (!/^oct[1-9A-HJ-NP-Za-km-z]{44}$/.test(circleId)) throw new Error("Download contains an invalid Circle address.");
    const asset = await loadCircleAsset(circleId, resource.path);
    total += asset.body.byteLength;
    if (total > 256 * 1024 * 1024) throw new Error("Download is larger than 256 MB.");
    chunks.push(asset.body);
    try {
      els.frame.contentWindow.postMessage({
        source: "circlet-download-progress",
        token: state.token,
        id,
        completed: index + 1,
        total: resources.length
      }, "*");
    } catch {}
  }
  const blob = new Blob(chunks, { type: mimeType });
  if (/^[0-9a-f]{64}$/i.test(String(payload.sha256 || ""))) {
    if (blob.size > 64 * 1024 * 1024) throw new Error("Integrity verification is limited to 64 MB.");
    const expected = String(payload.sha256).toLowerCase();
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    const actual = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (actual !== expected) throw new Error("Download integrity check failed.");
  }
  const url = URL.createObjectURL(blob);
  state.objectUrls.push(url);
  try {
    await chrome.downloads.download({ url, filename: fileName, saveAs: true });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  respond(id, true, { fileName });
}

function safeFileName(value) {
  const clean = String(value || "circle-download")
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 128);
  return clean || "circle-download";
}

function safeMime(value, fileName) {
  const explicit = String(value || "").trim().toLowerCase();
  if (/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(explicit)) return explicit;
  const lower = String(fileName || "").toLowerCase();
  if (lower.endsWith(".apk")) return "application/vnd.android.package-archive";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".zip")) return "application/zip";
  return "application/octet-stream";
}

async function writeClipboard(text) {
  if (String(text).length > 16384) throw new Error("Clipboard text is too large.");
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("aria-hidden", "true");
    area.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    document.body.append(area);
    area.focus();
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    if (!copied) throw new Error("Clipboard write was blocked.");
  }
}

async function copyText(text, message) {
  try {
    await writeClipboard(String(text || ""));
    SynteqToast(message || "Copied", "ok");
  } catch (error) {
    SynteqToast(error?.message || "Copy failed", "err");
  }
}

async function persistStorage(message) {
  const area = message.area === "session" ? "session" : "local";
  const storageArea = area === "session" ? chrome.storage.session : chrome.storage.local;
  if (!storageArea || !state.circleId) return;
  const key = storageKey(state.circleId, area);
  await storageArea.set({ [key]: sanitizeStorage(message.snapshot) });
}

async function storageSnapshot(circleId) {
  const local = await chrome.storage.local.get(storageKey(circleId, "local")).catch(() => ({}));
  const session = chrome.storage.session
    ? await chrome.storage.session.get(storageKey(circleId, "session")).catch(() => ({}))
    : {};
  return {
    local: sanitizeStorage(local[storageKey(circleId, "local")]),
    session: sanitizeStorage(session[storageKey(circleId, "session")])
  };
}

function storageKey(circleId, area) {
  return `circlet:storage:${state.network.id}:${circleId}:${area}`;
}

function sanitizeStorage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  let count = 0;
  let total = 0;
  for (const [key, item] of Object.entries(value)) {
    if (count >= MAX_STORAGE_ENTRIES) break;
    const text = String(item);
    if (text.length > MAX_STORAGE_VALUE) continue;
    const keyText = String(key).slice(0, 512);
    if (total + text.length + keyText.length > MAX_STORAGE_TOTAL) break;
    out[keyText] = text;
    total += text.length + keyText.length;
    count += 1;
  }
  return out;
}

function sealedKey(circleId) {
  return `circlet:passphrase:${state.network.id}:${circleId}`;
}

async function getStoredPassphrase(circleId) {
  if (!chrome.storage.session) return "";
  const key = sealedKey(circleId);
  const result = await chrome.storage.session.get(key).catch(() => ({}));
  const stored = result[key];
  if (!stored || typeof stored !== "object") return "";
  if (typeof stored.value !== "string" || !stored.value || Number(stored.expiresAt) <= Date.now()) {
    await chrome.storage.session.remove(key).catch(() => {});
    return "";
  }
  return stored.value;
}

async function storePassphrase(circleId, value) {
  if (!chrome.storage.session) return;
  await chrome.storage.session.set({
    [sealedKey(circleId)]: { value, expiresAt: Date.now() + SEALED_TTL_MS }
  }).catch(() => {});
}

async function removeStoredPassphrase(circleId = state.circleId) {
  if (!chrome.storage.session) return;
  await chrome.storage.session.remove(sealedKey(circleId)).catch(() => {});
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}
