import {
  activeNetwork,
  deleteDapp,
  loadSettings,
  normalizeSettings,
  patchSettings
} from "../core/settings.js";

const els = {
  overviewBody: document.getElementById("overviewBody"),
  overviewMeta: document.getElementById("overviewMeta"),
  walletTopText: document.getElementById("walletTopText"),
  walletTopDot: document.getElementById("walletTopDot"),
  walletDockStatus: document.getElementById("walletDockStatus"),
  walletDot: document.getElementById("walletDot"),
  accountList: document.getElementById("accountList"),
  sendForm: document.getElementById("sendForm"),
  sendTo: document.getElementById("sendTo"),
  sendAmount: document.getElementById("sendAmount"),
  sendPin: document.getElementById("sendPin"),
  sendMessage: document.getElementById("sendMessage"),
  sendResult: document.getElementById("sendResult"),
  sendSubmit: document.getElementById("sendSubmit"),
  historyList: document.getElementById("historyList"),
  dappList: document.getElementById("dappList"),
  walletInfo: document.getElementById("walletInfo"),
  webcliUrlForm: document.getElementById("webcliUrlForm"),
  webcliUrl: document.getElementById("webcliUrl"),
  walletSettingsForm: document.getElementById("walletSettingsForm"),
  walletRpc: document.getElementById("walletRpc"),
  walletExplorer: document.getElementById("walletExplorer"),
  walletSettingsPin: document.getElementById("walletSettingsPin"),
  actionDialog: document.getElementById("actionDialog"),
  actionForm: document.getElementById("actionForm"),
  actionTitle: document.getElementById("actionTitle"),
  actionDescription: document.getElementById("actionDescription"),
  actionFields: document.getElementById("actionFields"),
  actionConfirm: document.getElementById("actionConfirm")
};

const state = {
  settings: null,
  network: null,
  browser: null,
  wallet: null,
  accounts: null,
  balance: null,
  history: null,
  connected: false,
  busy: false
};

const ACTIONS = new Map();
let dialogResolve = null;

init().catch((error) => toast(error?.message || "Unable to load wallets.", "err"));

async function init() {
  state.settings = await loadSettings();
  state.network = activeNetwork(state.settings);
  els.webcliUrl.value = state.settings.webcliUrl;
  bind();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes["circlet:settings:v1"]) return;
    state.settings = normalizeSettings(changes["circlet:settings:v1"].newValue);
    state.network = activeNetwork(state.settings);
    els.webcliUrl.value = state.settings.webcliUrl;
    renderDapps();
  });
  await refreshAll();
}

function bind() {
  els.sendForm.addEventListener("submit", onSend);
  els.webcliUrlForm.addEventListener("submit", saveWebcliUrl);
  els.walletSettingsForm.addEventListener("submit", saveWalletSettings);
  document.getElementById("createWallet").addEventListener("click", createWallet);
  document.getElementById("importWallet").addEventListener("click", importWallet);
  document.getElementById("deriveAccount").addEventListener("click", deriveAccount);
  document.getElementById("refreshAccounts").addEventListener("click", refreshAccounts);
  document.getElementById("refreshHistory").addEventListener("click", loadHistory);
  document.getElementById("refreshDapps").addEventListener("click", () => renderDapps());
  document.getElementById("refreshBalance").addEventListener("click", () => refreshAll());
  document.getElementById("openWebcliTop").addEventListener("click", openWebcli);
  document.getElementById("openWebcliSettings").addEventListener("click", openWebcli);
  document.getElementById("lockWallet").addEventListener("click", lockWallet);
  document.getElementById("exportKey").addEventListener("click", exportKey);
  els.actionForm.addEventListener("submit", submitActionDialog);
  document.addEventListener("click", (event) => {
    if (event.target.closest?.("[data-close-action]")) {
      els.actionDialog.close();
      return;
    }
    const action = event.target.closest?.("[data-wallet-action]");
    if (action) {
      const handler = ACTIONS.get(action.dataset.walletAction);
      if (handler) handler(action.dataset);
    }
  });
  els.actionDialog.addEventListener("close", () => {
    if (dialogResolve) {
      const resolve = dialogResolve;
      dialogResolve = null;
      resolve(null);
    }
  });
}

async function wc(action, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type: `circlet:webcli:${action}`, ...payload });
  if (!response?.ok) {
    const error = new Error(response?.error || "webcli request failed");
    error.code = response?.code || "";
    error.status = response?.status || 0;
    throw error;
  }
  return response.data;
}

async function refreshAll() {
  if (state.busy) return;
  state.busy = true;
  setLoading(true);
  try {
    const status = await wc("status");
    state.browser = status.browser || null;
    state.wallet = status.wallet || null;
    state.accounts = status.accounts || null;
    state.connected = Boolean(status.connected);
    if (state.wallet) {
      state.balance = await wc("request", { path: "/api/balance", method: "GET" }).catch(() => null);
      state.history = await wc("request", { path: "/api/history?limit=50&offset=0", method: "GET" }).catch(() => null);
      els.walletRpc.value = state.wallet.rpc_url || "";
      els.walletExplorer.value = state.wallet.explorer_url || "";
    } else {
      state.balance = null;
      state.history = null;
    }
    renderStatus();
    renderOverview();
    renderAccounts();
    renderHistory();
    renderWalletInfo();
    renderDapps();
  } catch (error) {
    state.browser = null;
    state.wallet = null;
    state.accounts = null;
    state.connected = false;
    renderStatus(error);
    renderOverview(error);
    renderAccounts();
    renderHistory();
    renderWalletInfo();
    renderDapps();
  } finally {
    state.busy = false;
    setLoading(false);
  }
}

async function refreshAccounts() {
  if (!state.connected) return;
  state.accounts = await wc("request", { path: "/api/wallet/accounts", method: "GET" }).catch(() => null);
  renderAccounts();
  toast("Accounts refreshed", "ok");
}

function renderStatus(error) {
  const ok = state.connected;
  const color = error ? "var(--sq-status-error)" : ok ? "var(--sq-status-running)" : "var(--sq-status-warning)";
  for (const dot of [els.walletTopDot, els.walletDot]) dot.style.background = color;
  const text = error ? "offline" : ok ? (state.wallet ? "unlocked" : "connected") : "locked";
  els.walletTopText.textContent = text;
  els.walletDockStatus.textContent = error ? "webcli offline" : state.wallet ? shortAddress(state.wallet.address) : ok ? "wallet ready" : "wallet locked";
  els.overviewMeta.textContent = error ? "offline" : ok ? "webcli connected" : "webcli";
}

function renderOverview(error) {
  els.overviewBody.replaceChildren();
  if (error) {
    els.overviewBody.append(alertBlock("webcli is unreachable", error.message, "err"));
  }
  if (!state.connected) {
    renderConnect();
    return;
  }
  if (!state.wallet) {
    renderConnect();
    return;
  }
  const balance = state.balance || {};
  const account = activeAccount();
  const stats = document.createElement("div");
  stats.className = "sq-stat-strip";
  stats.append(
    stat("Account", account?.name || shortAddress(state.wallet.address)),
    stat("Address", shortAddress(state.wallet.address, 10, 8), true),
    stat("Public balance", formatAmount(balance.public_balance), false, "OCT"),
    stat("Nonce", String(balance.nonce ?? "—"), true)
  );
  const actions = document.createElement("div");
  actions.className = "c-actions";
  actions.append(
    button("Refresh", "refresh", () => refreshAll(), "ghost"),
    button("Open webcli", "external", openWebcli, "ghost"),
    button("Lock wallet", "lock", lockWallet, "danger")
  );
  const kv = document.createElement("div");
  kv.className = "sq-kv";
  kv.append(
    kvRow("Network", state.network.name),
    kvRow("Wallet RPC", state.wallet.rpc_url || "—", true),
    kvRow("Generation", state.wallet.generation || "—", true),
    kvRow("HD wallet", state.wallet.has_master_seed ? "yes" : "no"),
    kvRow("Bridge signer", state.wallet.bridge_signer_url || "not configured", true)
  );
  els.overviewBody.append(stats, actions, kv);
}

function renderConnect() {
  const browser = state.browser || {};
  const wallets = Array.isArray(browser.wallets) ? browser.wallets : [];
  const grid = document.createElement("div");
  grid.className = "c-connect-grid";

  const unlockPanel = connectPanel(
    "Unlock existing wallet",
    "Choose a wallet already stored in webcli and enter its PIN."
  );
  if (wallets.length) {
    const unlockForm = document.createElement("form");
    unlockForm.className = "c-col";
    const walletSelect = selectField("Wallet", wallets.map((wallet) => ({
      value: wallet.addr,
      label: `${wallet.name || "wallet"} · ${shortAddress(wallet.addr)}`
    })));
    const pinField = field("PIN", "password", "", "Wallet PIN");
    const unlock = button("Unlock wallet", "lock", null, "brand");
    unlock.type = "submit";
    unlockForm.append(walletSelect.root, pinField.root, unlock);
    unlockForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await loginWallet(walletSelect.select.value, pinField.input.value);
      pinField.input.value = "";
    });
    unlockPanel.append(unlockForm);
  } else {
    unlockPanel.append(
      note("No wallet found in webcli yet."),
      button("Create in webcli", "external", openWebcli, "ghost")
    );
  }

  const or = document.createElement("div");
  or.className = "c-connect-or";
  or.setAttribute("aria-hidden", "true");
  or.innerHTML = '<span class="c-connect-or__line"></span><span class="c-connect-or__label">OR</span><span class="c-connect-or__line"></span>';

  const tokenPanel = connectPanel(
    "Connect with API key",
    "Paste the webcli API key or the full launch URL. Use this for a new or locked webcli instance."
  );
  const tokenForm = document.createElement("form");
  tokenForm.className = "c-col";
  const tokenField = field("API key or launch URL", "text", "", "64-character key or webcli launch URL");
  const tokenInput = tokenField.input;
  const tokenRow = document.createElement("div");
  tokenRow.className = "c-actions";
  const connect = button("Connect API key", "link", null, "primary");
  connect.type = "submit";
  tokenForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = extractToken(tokenInput.value);
    if (!value) return toast("Enter a valid webcli API key or launch URL", "warn");
    setLoading(true);
    try {
      await wc("token", { token: value });
      tokenInput.value = "";
      toast("webcli connected", "ok");
      await refreshAll();
    } catch (error) {
      toast(error.message || "Unable to connect webcli", "err");
    } finally {
      setLoading(false);
    }
  });
  tokenRow.append(connect, button("Open webcli", "external", openWebcli, "ghost"));
  tokenForm.append(tokenField.root, tokenRow);
  tokenPanel.append(tokenForm);

  grid.append(unlockPanel, or, tokenPanel);
  els.overviewBody.append(grid);
}

function connectPanel(title, description) {
  const panel = document.createElement("div");
  panel.className = "c-col c-connect-panel";
  const heading = document.createElement("div");
  heading.className = "c-connect-title";
  heading.textContent = title;
  const copy = document.createElement("div");
  copy.className = "c-hint";
  copy.textContent = description;
  panel.append(heading, copy);
  return panel;
}

function renderAccounts() {
  els.accountList.replaceChildren();
  const accounts = state.accounts?.accounts || [];
  if (!state.connected) {
    els.accountList.append(note("Connect webcli to manage accounts."));
    return;
  }
  if (!accounts.length) {
    els.accountList.append(note(state.wallet ? "No accounts found." : "No wallet is loaded. Unlock or create a wallet first."));
    return;
  }
  for (const account of accounts) {
    const row = document.createElement("div");
    row.className = "c-list__row";
    const copy = document.createElement("div");
    copy.className = "c-col";
    copy.style.gap = "2px";
    const title = document.createElement("span");
    title.className = "c-list__title";
    title.textContent = `${account.name || "account"}${account.active ? " · active" : ""}`;
    const meta = document.createElement("span");
    meta.className = "c-list__meta c-mono";
    meta.textContent = `${account.addr}${account.hd ? ` · HD #${account.hd_index}` : ""}`;
    copy.append(title, meta);
    const actions = document.createElement("div");
    actions.className = "c-actions c-actions--end";
    if (!account.active) {
      actions.append(
        actionButton("Use", "check", "use", { address: account.addr }),
        actionButton("Rename", "edit", "rename", { address: account.addr, name: account.name || "" }),
        actionButton("Remove", "trash", "remove", { address: account.addr }, "danger")
      );
    }
    row.append(copy, actions);
    els.accountList.append(row);
  }
  if (!state.accounts?.has_master_seed) {
    els.accountList.append(note("This wallet was imported from a private key; HD account derivation is unavailable."));
  }
}

function renderHistory() {
  els.historyList.replaceChildren();
  const txs = state.history?.transactions || state.history?.local || [];
  if (!state.connected || !state.wallet) {
    els.historyList.append(note("Unlock a wallet to load transaction history."));
    return;
  }
  if (!txs.length) {
    els.historyList.append(note("No transactions found."));
    return;
  }
  for (const tx of txs.slice(0, 50)) {
    const row = document.createElement("div");
    row.className = "c-list__row";
    const copy = document.createElement("div");
    copy.className = "c-col";
    copy.style.gap = "2px";
    const title = document.createElement("span");
    title.className = "c-list__title c-mono c-truncate";
    title.textContent = tx.hash || tx.tx_hash || "pending transaction";
    const meta = document.createElement("span");
    meta.className = "c-list__meta c-truncate";
    meta.textContent = `${tx.status || "unknown"} · ${tx.op_type || "standard"} · ${formatAmount(tx.amount_raw)} OCT`;
    copy.append(title, meta);
    const side = document.createElement("span");
    side.className = "c-list__meta c-mono c-truncate";
    side.textContent = tx.to_ || tx.to || "";
    row.append(copy, side);
    els.historyList.append(row);
  }
}

function renderWalletInfo() {
  els.walletInfo.replaceChildren();
  els.walletInfo.append(
    kvRow("Status", state.connected ? (state.wallet ? "unlocked" : "connected") : "locked"),
    kvRow("Address", state.wallet?.address || "—", true),
    kvRow("Network", state.network.name),
    kvRow("webcli", state.settings.webcliUrl, true),
    kvRow("Wallet RPC", state.wallet?.rpc_url || "—", true),
    kvRow("Generation", state.wallet?.generation || "—", true)
  );
  els.walletSettingsForm.querySelectorAll("input,button").forEach((node) => {
    node.disabled = !state.wallet;
  });
  document.getElementById("exportKey").disabled = !state.wallet;
  document.getElementById("lockWallet").disabled = !state.wallet;
}

function renderDapps() {
  els.dappList.replaceChildren();
  const dapps = state.settings.dapps || [];
  if (!dapps.length) {
    els.dappList.append(note("No connected dapps. A Circle will appear here after you approve a wallet connection."));
    return;
  }
  for (const dapp of dapps) {
    const row = document.createElement("div");
    row.className = "c-list__row";
    const copy = document.createElement("div");
    copy.className = "c-col";
    copy.style.gap = "2px";
    const title = document.createElement("span");
    title.className = "c-list__title c-truncate";
    title.textContent = dapp.title || dapp.display;
    const meta = document.createElement("span");
    meta.className = "c-list__meta c-mono c-truncate";
    meta.textContent = `${dapp.display} · ${dapp.networkId} · ${dapp.address ? shortAddress(dapp.address) : "no account"}`;
    const perms = document.createElement("span");
    perms.className = "c-list__meta";
    perms.textContent = `permissions: ${dapp.permissions.join(", ")}`;
    copy.append(title, meta, perms);
    const actions = document.createElement("div");
    actions.className = "c-actions c-actions--end";
    actions.append(
      button("Open", "external", () => openDapp(dapp), "ghost"),
      button("Revoke", "trash", async () => {
        state.settings = await deleteDapp(dapp.id);
        renderDapps();
        toast("Dapp revoked", "ok");
      }, "danger")
    );
    row.append(copy, actions);
    els.dappList.append(row);
  }
}

function openDapp(dapp) {
  const params = new URLSearchParams({
    circleId: dapp.circleId,
    path: "/index.html",
    display: dapp.display,
    net: dapp.networkId
  });
  chrome.tabs.create({ url: chrome.runtime.getURL(`viewer.html?${params.toString()}`) });
}

async function loginWallet(address, pin) {
  if (!address || !pin) return toast("Wallet and PIN are required", "warn");
  setLoading(true);
  try {
    await wc("login", { address, pin });
    toast("Wallet unlocked", "ok");
    await refreshAll();
  } catch (error) {
    toast(error.message || "Unable to unlock wallet", "err");
  } finally {
    setLoading(false);
  }
}

async function createWallet() {
  if (!state.connected) return toast("Connect webcli first", "warn");
  if (state.wallet) return toast("Lock the active wallet before creating another", "warn");
  const values = await actionDialog({
    title: "Create wallet",
    description: "webcli generates a 12-word recovery phrase. Store it offline before using the wallet.",
    confirm: "Create wallet",
    fields: [
      { name: "name", label: "Wallet name", value: "wallet", required: true },
      { name: "pin", label: "New PIN", type: "password", required: true },
      { name: "confirm", label: "Confirm PIN", type: "password", required: true }
    ]
  });
  if (!values) return;
  if (values.pin !== values.confirm) return toast("PIN confirmation does not match", "warn");
  setLoading(true);
  try {
    const result = await wc("request", {
      path: "/api/wallet/create",
      method: "POST",
      body: { name: values.name, pin: values.pin }
    });
    await refreshAll();
    await showSecret("Wallet created", `Address: ${result.address}\n\nRecovery phrase:\n${result.mnemonic || "(not returned)"}`);
  } catch (error) {
    toast(error.message || "Unable to create wallet", "err");
  } finally {
    setLoading(false);
  }
}

async function importWallet() {
  if (!state.connected) return toast("Connect webcli first", "warn");
  if (state.wallet) return toast("Lock the active wallet before importing another", "warn");
  const values = await actionDialog({
    title: "Import wallet",
    description: "Import a private key or 12/24-word recovery phrase. The secret is sent only to local webcli.",
    confirm: "Import wallet",
    fields: [
      { name: "name", label: "Wallet name", value: "imported", required: true },
      { name: "secret", label: "Private key or recovery phrase", type: "textarea", required: true },
      { name: "pin", label: "New PIN", type: "password", required: true },
      { name: "confirm", label: "Confirm PIN", type: "password", required: true }
    ]
  });
  if (!values) return;
  if (values.pin !== values.confirm) return toast("PIN confirmation does not match", "warn");
  const secret = values.secret.trim();
  const body = { name: values.name, pin: values.pin };
  if (secret.split(/\s+/).length >= 12) body.mnemonic = secret;
  else body.priv = secret;
  setLoading(true);
  try {
    const result = await wc("request", { path: "/api/wallet/import", method: "POST", body });
    await refreshAll();
    toast(`Imported ${shortAddress(result.address || "")}`, "ok");
  } catch (error) {
    toast(error.message || "Unable to import wallet", "err");
  } finally {
    setLoading(false);
  }
}

async function deriveAccount() {
  if (!state.accounts?.has_master_seed) return toast("Active wallet has no master seed", "warn");
  const values = await actionDialog({
    title: "Derive account",
    description: "Create the next HD account from the active wallet seed.",
    confirm: "Derive",
    fields: [
      { name: "name", label: "Account name", placeholder: "next account", value: "" },
      { name: "pin", label: "PIN", type: "password", required: true }
    ]
  });
  if (!values) return;
  setLoading(true);
  try {
    await wc("request", { path: "/api/wallet/derive", method: "POST", body: { name: values.name, pin: values.pin } });
    toast("Account derived", "ok");
    await refreshAll();
  } catch (error) {
    toast(error.message || "Unable to derive account", "err");
  } finally {
    setLoading(false);
  }
}

async function useAccount(address) {
  const values = await actionDialog({
    title: "Switch account",
    description: "Unlock the selected account with its PIN.",
    confirm: "Switch",
    fields: [{ name: "pin", label: "PIN", type: "password", required: true }]
  });
  if (!values) return;
  await loginWallet(address, values.pin);
}

async function renameAccount(address, name) {
  const values = await actionDialog({
    title: "Rename account",
    description: "Set a display name in the webcli manifest.",
    confirm: "Rename",
    fields: [{ name: "name", label: "Account name", value: name || "account", required: true }]
  });
  if (!values) return;
  setLoading(true);
  try {
    await wc("request", { path: "/api/wallet/rename", method: "POST", body: { addr: address, name: values.name } });
    toast("Account renamed", "ok");
    await refreshAll();
  } catch (error) {
    toast(error.message || "Unable to rename account", "err");
  } finally {
    setLoading(false);
  }
}

async function removeAccount(address) {
  const values = await actionDialog({
    title: "Remove account",
    description: "Removes the account from the webcli manifest. The wallet file is not deleted by this action.",
    confirm: "Remove",
    fields: []
  });
  if (!values) return;
  setLoading(true);
  try {
    await wc("request", { path: "/api/wallet/account", method: "DELETE", body: { addr: address } });
    toast("Account removed", "ok");
    await refreshAll();
  } catch (error) {
    toast(error.message || "Unable to remove account", "err");
  } finally {
    setLoading(false);
  }
}

async function onSend(event) {
  event.preventDefault();
  if (!state.wallet) return toast("Unlock a wallet first", "warn");
  const body = {
    to: els.sendTo.value.trim(),
    amount: els.sendAmount.value.trim(),
    message: els.sendMessage.value.trim(),
    pin: els.sendPin.value
  };
  if (!body.to || !body.amount || !body.pin) return toast("Recipient, amount, and PIN are required", "warn");
  els.sendSubmit.disabled = true;
  setLoading(true);
  try {
    const result = await wc("request", { path: "/api/send", method: "POST", body });
    els.sendResult.textContent = JSON.stringify(result, null, 2);
    els.sendPin.value = "";
    toast("Transaction submitted", "ok");
    await refreshAll();
  } catch (error) {
    els.sendResult.textContent = error.message || "Send failed";
    toast(error.message || "Send failed", "err");
  } finally {
    els.sendSubmit.disabled = false;
    setLoading(false);
  }
}

async function loadHistory() {
  if (!state.wallet) return toast("Unlock a wallet first", "warn");
  setLoading(true);
  try {
    state.history = await wc("request", { path: "/api/history?limit=50&offset=0", method: "GET" });
    renderHistory();
    toast("History refreshed", "ok");
  } catch (error) {
    toast(error.message || "Unable to load history", "err");
  } finally {
    setLoading(false);
  }
}

async function saveWebcliUrl(event) {
  event.preventDefault();
  const value = els.webcliUrl.value.trim();
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(value) && !/^http:\/\/\[::1\](?::\d+)?$/i.test(value)) {
    return toast("Use a local http://127.0.0.1 or http://localhost URL", "warn");
  }
  state.settings = await patchSettings({ webcliUrl: value });
  state.network = activeNetwork(state.settings);
  toast("webcli URL saved", "ok");
  await refreshAll();
}

async function saveWalletSettings(event) {
  event.preventDefault();
  if (!state.wallet) return toast("Unlock a wallet first", "warn");
  const pin = els.walletSettingsPin.value;
  if (!pin) return toast("PIN is required", "warn");
  setLoading(true);
  try {
    await wc("request", {
      path: "/api/settings",
      method: "POST",
      body: {
        rpc_url: els.walletRpc.value.trim() || state.wallet.rpc_url,
        explorer_url: els.walletExplorer.value.trim() || state.wallet.explorer_url || "",
        bridge_signer_url: state.wallet.bridge_signer_url || "",
        pin,
        expected_wallet: state.wallet.address,
        expected_generation: state.wallet.generation
      }
    });
    els.walletSettingsPin.value = "";
    toast("Wallet RPC updated", "ok");
    await refreshAll();
  } catch (error) {
    toast(error.message || "Unable to update wallet settings", "err");
  } finally {
    setLoading(false);
  }
}

async function lockWallet() {
  if (!state.wallet) return;
  const values = await actionDialog({
    title: "Lock wallet",
    description: "webcli will drop the active session and require the PIN again.",
    confirm: "Lock",
    fields: []
  });
  if (!values) return;
  setLoading(true);
  try {
    await wc("logout", { lock: true });
    toast("Wallet locked", "ok");
    await refreshAll();
  } catch (error) {
    toast(error.message || "Unable to lock wallet", "err");
  } finally {
    setLoading(false);
  }
}

async function exportKey() {
  if (!state.wallet) return;
  const values = await actionDialog({
    title: "Export private key",
    description: "This reveals the active wallet private key and recovery phrase. Never share them.",
    confirm: "Reveal",
    fields: [
      { name: "confirm", label: "Type EXPORT to confirm", required: true },
      { name: "pin", label: "PIN", type: "password", required: true }
    ]
  });
  if (!values) return;
  if (values.confirm !== "EXPORT") return toast("Confirmation text did not match", "warn");
  setLoading(true);
  try {
    const result = await wc("request", {
      path: "/api/keys/private",
      method: "POST",
      body: { confirm: "I_UNDERSTAND_KEY_EXPORT_RISK", pin: values.pin }
    });
    await showSecret("Private key", `Private key:\n${result.private_key || "(not returned)"}\n\nRecovery phrase:\n${result.mnemonic || "(none)"}`);
  } catch (error) {
    toast(error.message || "Unable to export key", "err");
  } finally {
    setLoading(false);
  }
}

async function openWebcli() {
  try {
    await wc("open");
  } catch (error) {
    toast(error.message || "Unable to open webcli", "err");
  }
}

function actionDialog({ title, description, fields, confirm }) {
  return new Promise((resolve) => {
    dialogResolve = resolve;
    els.actionTitle.textContent = title;
    els.actionDescription.textContent = description || "";
    els.actionConfirm.textContent = confirm || "Confirm";
    els.actionFields.replaceChildren();
    for (const fieldDef of fields || []) {
      const node = fieldDef.type === "textarea"
        ? textareaField(fieldDef)
        : fieldDef.type === "select"
          ? selectField(fieldDef.label, fieldDef.options || [])
          : field(fieldDef.label, fieldDef.type || "text", fieldDef.value || "", fieldDef.placeholder || "", fieldDef.required);
      node.root.dataset.name = fieldDef.name;
      els.actionFields.append(node.root);
    }
    els.actionDialog.showModal();
    setTimeout(() => els.actionFields.querySelector("input,textarea,select")?.focus(), 40);
  });
}

function submitActionDialog(event) {
  event.preventDefault();
  const values = {};
  els.actionFields.querySelectorAll("[data-name]").forEach((root) => {
    const input = root.querySelector("input,textarea,select");
    const key = root.dataset.name;
    if (!key) return;
    values[key] = input ? input.value : "";
  });
  for (const input of els.actionFields.querySelectorAll("[required]")) {
    if (!String(input.value || "").trim()) {
      input.focus();
      return;
    }
  }
  const resolve = dialogResolve;
  dialogResolve = null;
  els.actionDialog.close();
  resolve?.(values);
}

async function showSecret(title, text) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "sq-dialog sq-dialog--lg";
    dialog.innerHTML = `
      <div class="sq-dialog__header"><h2 class="sq-dialog__title"></h2><button class="sq-dialog__close" type="button" aria-label="Close"><svg class="sq-icon sq-icon--16" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
      <div class="sq-dialog__body"><pre class="sq-code__pre c-break" style="white-space:pre-wrap;"></pre></div>
      <div class="sq-dialog__footer"><button class="sq-btn sq-btn--ghost" type="button" data-copy>Copy</button><button class="sq-btn sq-btn--primary" type="button" data-close>Done</button></div>`;
    dialog.querySelector(".sq-dialog__title").textContent = title;
    dialog.querySelector("pre").textContent = text;
    const close = () => {
      dialog.close();
      dialog.remove();
      resolve();
    };
    dialog.querySelector("[data-close]").addEventListener("click", close);
    dialog.querySelector(".sq-dialog__close").addEventListener("click", close);
    dialog.querySelector("[data-copy]").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
        toast("Copied", "ok");
      } catch {
        toast("Copy failed", "err");
      }
    });
    dialog.addEventListener("cancel", close, { once: true });
    document.body.append(dialog);
    dialog.showModal();
  });
}

function actionButton(label, icon, action, data, variant) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `sq-btn sq-btn--${variant || "ghost"}`;
  btn.innerHTML = `<span class="c-btn-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${icon === "check" ? '<polyline points="20 6 9 17 4 12"/>' : icon === "edit" ? '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>' : icon === "trash" ? '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>' : "<!-- -->"}</svg></span>${label}`;
  ACTIONS.set(`${action}:${data.address}`, () => {
    if (action === "use") useAccount(data.address);
    else if (action === "rename") renameAccount(data.address, data.name);
    else if (action === "remove") removeAccount(data.address);
  });
  btn.dataset.walletAction = `${action}:${data.address}`;
  return btn;
}

function activeAccount() {
  return state.accounts?.accounts?.find((account) => account.active) || null;
}

function stat(label, value, mono, suffix) {
  const node = document.createElement("div");
  node.className = "sq-stat";
  const l = document.createElement("span");
  l.className = "sq-stat__label";
  l.textContent = label;
  const v = document.createElement("div");
  v.className = `sq-stat__value${mono ? " c-mono" : ""}`;
  v.textContent = value;
  if (suffix) v.title = suffix;
  node.append(l, v);
  return node;
}

function kvRow(label, value, mono) {
  const row = document.createElement("div");
  row.className = "sq-kv__row";
  const key = document.createElement("span");
  key.className = "sq-kv__label";
  key.textContent = label;
  const val = document.createElement("span");
  val.className = `sq-kv__value c-break${mono ? " sq-mono" : ""}`;
  val.textContent = value || "—";
  row.append(key, val);
  return row;
}

function alertBlock(title, message, kind) {
  const box = document.createElement("div");
  box.className = `sq-alert sq-alert--${kind || "warn"}`;
  box.innerHTML = `<div class="sq-alert__content"><div class="sq-alert__title"></div><div class="sq-alert__message"></div></div>`;
  box.querySelector(".sq-alert__title").textContent = title;
  box.querySelector(".sq-alert__message").textContent = message;
  return box;
}

function field(label, type, value, placeholder, required) {
  const root = document.createElement("div");
  root.className = "sq-field";
  const l = document.createElement("label");
  l.className = "sq-field__label";
  l.textContent = label;
  const input = document.createElement("input");
  input.className = "sq-input";
  input.type = type;
  input.value = value || "";
  input.placeholder = placeholder || "";
  input.required = Boolean(required);
  input.autocomplete = "off";
  root.append(l, input);
  return { root, input };
}

function textareaField(def) {
  const root = document.createElement("div");
  root.className = "sq-field";
  const label = document.createElement("label");
  label.className = "sq-field__label";
  label.textContent = def.label;
  const input = document.createElement("textarea");
  input.className = "sq-textarea";
  input.rows = 4;
  input.value = def.value || "";
  input.placeholder = def.placeholder || "";
  input.required = Boolean(def.required);
  input.autocomplete = "off";
  root.append(label, input);
  return { root, input };
}

function selectField(label, options) {
  const root = document.createElement("div");
  root.className = "sq-field";
  const l = document.createElement("label");
  l.className = "sq-field__label";
  l.textContent = label;
  const select = document.createElement("select");
  select.className = "sq-select";
  for (const option of options) {
    const opt = document.createElement("option");
    opt.value = option.value;
    opt.textContent = option.label;
    select.append(opt);
  }
  root.append(l, select);
  return { root, select };
}

function note(text) {
  const node = document.createElement("div");
  node.className = "c-empty-mini";
  node.textContent = text;
  return node;
}

function button(label, icon, handler, variant) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `sq-btn sq-btn--${variant || "ghost"}`;
  btn.textContent = label;
  if (handler) btn.addEventListener("click", handler);
  return btn;
}

function extractToken(value) {
  const match = /([0-9a-f]{64})/.exec(String(value || ""));
  return match ? match[1] : "";
}

function formatAmount(raw) {
  try {
    const text = String(raw || "0").replace(/^0+(?=[0-9])/, "");
    const padded = text.padStart(7, "0");
    const fraction = padded.slice(-6).replace(/0+$/, "");
    const whole = padded.slice(0, -6);
    return fraction ? `${whole}.${fraction}` : whole;
  } catch {
    return "—";
  }
}

function shortAddress(value, head = 8, tail = 6) {
  const text = String(value || "");
  return text.length > head + tail + 3 ? `${text.slice(0, head)}...${text.slice(-tail)}` : text;
}

function setLoading(active) {
  try {
    window.SynteqUI?.setLoading(Boolean(active));
  } catch {}
}

function toast(message, kind) {
  try {
    window.SynteqUI?.toast(message, { kind: kind || "info" });
  } catch {}
}
