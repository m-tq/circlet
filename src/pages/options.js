import {
  activeNetwork,
  clearBookmarks,
  clearRecent,
  loadSettings,
  patchSettings,
  saveSettings,
  setActiveNetwork
} from "../core/settings.js";

const els = {
  networkList: document.getElementById("networkList"),
  addNetwork: document.getElementById("addNetwork"),
  identityRows: document.getElementById("identityRows"),
  remoteSwitch: document.getElementById("remoteSwitch"),
  forgetAll: document.getElementById("forgetAllPassphrases"),
  dataRecent: document.getElementById("dataRecent"),
  dataBookmarks: document.getElementById("dataBookmarks"),
  dataBytes: document.getElementById("dataBytes"),
  dataSecrets: document.getElementById("dataSecrets"),
  clearRecent: document.getElementById("clearRecent"),
  clearBookmarks: document.getElementById("clearBookmarks"),
  clearCircleStorage: document.getElementById("clearCircleStorage"),
  exportSettings: document.getElementById("exportSettings"),
  importFile: document.getElementById("importFile"),
  dialog: document.getElementById("networkDialog"),
  dialogTitle: document.getElementById("networkDialogTitle"),
  form: document.getElementById("networkForm"),
  name: document.getElementById("networkName"),
  type: document.getElementById("networkType"),
  rpc: document.getElementById("networkRpc"),
  explorer: document.getElementById("networkExplorer"),
  identity: document.getElementById("networkIdentity"),
  id: document.getElementById("networkId"),
  aboutVersion: document.getElementById("aboutVersion")
};

const state = { settings: null, editingId: null };

init().catch((error) => toast(error?.message || "Unable to load settings.", "err"));

async function init() {
  state.settings = await loadSettings();
  bind();
  renderAll();
  els.aboutVersion.textContent = chrome.runtime.getManifest().version;
}

function bind() {
  els.addNetwork.addEventListener("click", () => openDialog(null));
  els.form.addEventListener("submit", onSaveNetwork);
  els.remoteSwitch.addEventListener("change", async () => {
    state.settings = await patchSettings({ allowRemoteNetwork: els.remoteSwitch.checked });
    toast(els.remoteSwitch.checked ? "Remote assets allowed" : "Remote assets blocked", "ok");
    renderPrivacy();
  });
  els.forgetAll.addEventListener("click", forgetAllPassphrases);
  els.clearRecent.addEventListener("click", async () => {
    state.settings = await clearRecent();
    renderData();
    toast("Recent Circles cleared", "ok");
  });
  els.clearBookmarks.addEventListener("click", async () => {
    state.settings = await clearBookmarks();
    renderData();
    toast("Bookmarks cleared", "ok");
  });
  els.clearCircleStorage.addEventListener("click", clearCircleStorage);
  els.exportSettings.addEventListener("click", exportSettings);
  els.importFile.addEventListener("change", importSettings);

  document.addEventListener("click", async (event) => {
    if (event.target.closest?.("[data-close-dialog]")) {
      event.target.closest("dialog")?.close();
      return;
    }
    const use = event.target.closest?.("[data-use-network]");
    if (use) {
      state.settings = await setActiveNetwork(use.dataset.useNetwork);
      renderAll();
      toast("Active network changed", "ok");
      return;
    }
    const edit = event.target.closest?.("[data-edit-network]");
    if (edit) {
      openDialog(state.settings.networks.find((network) => network.id === edit.dataset.editNetwork) || null);
      return;
    }
    const remove = event.target.closest?.("[data-remove-network]");
    if (remove) {
      await removeNetwork(remove.dataset.removeNetwork);
    }
  });
}

function renderAll() {
  renderNetworks();
  renderIdentity();
  renderPrivacy();
  renderData();
}

function renderNetworks() {
  els.networkList.replaceChildren();
  const active = activeNetwork(state.settings);
  for (const network of state.settings.networks) {
    const row = document.createElement("div");
    row.className = "c-list__row";
    const copy = document.createElement("div");
    copy.className = "c-network-name";
    const nameLine = document.createElement("strong");
    nameLine.textContent = network.name;
    if (network.id === active.id) {
      const badge = document.createElement("span");
      badge.className = "sq-badge sq-badge--ok";
      badge.style.marginLeft = "var(--sq-space-2)";
      badge.textContent = "active";
      nameLine.append(badge);
    }
    if (network.isDefault) {
      const badge = document.createElement("span");
      badge.className = "sq-badge";
      badge.style.marginLeft = "var(--sq-space-2)";
      badge.textContent = "built-in";
      nameLine.append(badge);
    }
    const meta = document.createElement("small");
    meta.textContent = `${network.type} · ${network.rpcUrls.join(" → ")}`;
    const identity = document.createElement("small");
    identity.className = "c-mono c-truncate";
    identity.textContent = network.identity ? `name service ${network.identity}` : "no name service contract";
    copy.append(nameLine, meta, identity);

    const actions = document.createElement("div");
    actions.className = "c-actions c-actions--end";
    if (network.id !== active.id) {
      const use = document.createElement("button");
      use.type = "button";
      use.className = "sq-btn sq-btn--ghost";
      use.dataset.useNetwork = network.id;
      use.textContent = "Use";
      actions.append(use);
    }
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "sq-btn sq-btn--ghost";
    edit.dataset.editNetwork = network.id;
    edit.textContent = "Edit";
    actions.append(edit);
    if (!network.isDefault) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "sq-btn sq-btn--danger";
      remove.dataset.removeNetwork = network.id;
      remove.textContent = "Remove";
      actions.append(remove);
    }
    row.append(copy, actions);
    els.networkList.append(row);
  }
}

function renderIdentity() {
  els.identityRows.replaceChildren();
  for (const network of state.settings.networks) {
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = network.name;
    const type = document.createElement("td");
    type.className = "sq-table__mute";
    type.textContent = network.type;
    const identity = document.createElement("td");
    identity.className = "sq-table__mono c-break";
    identity.textContent = network.identity || "—";
    const stateCell = document.createElement("td");
    stateCell.className = "sq-table__num";
    const badge = document.createElement("span");
    badge.className = network.identity ? "sq-badge sq-badge--ok" : "sq-badge sq-badge--warn";
    badge.textContent = network.identity ? "configured" : "missing";
    stateCell.append(badge);
    tr.append(name, type, identity, stateCell);
    els.identityRows.append(tr);
  }
}

function renderPrivacy() {
  els.remoteSwitch.checked = Boolean(state.settings.allowRemoteNetwork);
  els.remoteSwitch.setAttribute("aria-checked", String(Boolean(state.settings.allowRemoteNetwork)));
}

async function renderData() {
  els.dataRecent.textContent = String(state.settings.recent.length);
  els.dataBookmarks.textContent = String(state.settings.bookmarks?.length || 0);
  const bytes = await chrome.storage.local.getBytesInUse(null).catch(() => 0);
  els.dataBytes.textContent = formatBytes(bytes);
  const session = chrome.storage.session ? await chrome.storage.session.get(null).catch(() => ({})) : {};
  const secrets = Object.keys(session).filter((key) => key.startsWith("circlet:passphrase:")).length;
  els.dataSecrets.textContent = String(secrets);
}

function openDialog(network) {
  state.editingId = network?.id || null;
  els.dialogTitle.textContent = network ? "Edit network" : "Add network";
  els.name.value = network?.name || "";
  els.type.value = network?.type || "custom";
  els.rpc.value = network?.rpcUrls?.join("\n") || "";
  els.explorer.value = network?.explorer || "";
  els.identity.value = network?.identity || "";
  els.id.value = network?.id || "";
  els.id.disabled = Boolean(network?.isDefault);
  els.dialog.showModal();
  els.name.focus();
}

async function onSaveNetwork(event) {
  event.preventDefault();
  const name = els.name.value.trim();
  const rpcUrls = els.rpc.value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const type = els.type.value;
  const explorer = els.explorer.value.trim();
  const identity = els.identity.value.trim();
  const requestedId = els.id.value.trim();
  if (!name) return toast("Network name is required", "warn");
  if (!rpcUrls.length) return toast("At least one RPC endpoint is required", "warn");
  if (rpcUrls.some((url) => !/^https?:\/\/[^\s]+$/i.test(url))) return toast("RPC endpoints must be HTTP(S) URLs", "warn");
  if (explorer && !/^https?:\/\/[^\s]+$/i.test(explorer)) return toast("Explorer must be an HTTP(S) URL", "warn");
  if (identity && !/^oct[1-9A-HJ-NP-Za-km-z]{44}$/.test(identity)) return toast("Identity contract must be an Octra address", "warn");

  const existing = state.editingId ? state.settings.networks.find((network) => network.id === state.editingId) : null;
  const network = {
    id: existing?.id || requestedId || undefined,
    name,
    type,
    rpcUrls,
    explorer,
    identity,
    chainId: existing?.chainId || "",
    isDefault: Boolean(existing?.isDefault)
  };
  const networks = existing
    ? state.settings.networks.map((item) => (item.id === existing.id ? network : item))
    : [...state.settings.networks, network];
  const next = await saveSettings({ ...state.settings, networks });
  state.settings = next;
  const saved = existing
    ? next.networks.find((item) => item.id === existing.id)
    : next.networks.find((item) => item.name === name && item.rpcUrls.join() === rpcUrls.join());
  if (!saved) return toast("Network could not be saved. Check the stable ID.", "err");
  els.dialog.close();
  state.editingId = null;
  renderAll();
  toast("Network saved", "ok");
}

async function removeNetwork(id) {
  const network = state.settings.networks.find((item) => item.id === id);
  if (!network) return;
  if (network.isDefault) return toast("Built-in networks cannot be removed", "warn");
  const remaining = state.settings.networks.filter((item) => item.id !== id);
  const next = await saveSettings({ ...state.settings, networks: remaining });
  state.settings = next;
  if (next.activeNetworkId === id) {
    state.settings = await setActiveNetwork("devnet");
  }
  renderAll();
  toast("Network removed", "ok");
}

async function forgetAllPassphrases() {
  if (!chrome.storage.session) return;
  const all = await chrome.storage.session.get(null).catch(() => ({}));
  const keys = Object.keys(all).filter((key) => key.startsWith("circlet:passphrase:"));
  if (keys.length) await chrome.storage.session.remove(keys);
  renderData();
  toast(keys.length ? `Forgot ${keys.length} passphrase${keys.length === 1 ? "" : "s"}` : "No stored passphrases", "ok");
}

async function clearCircleStorage() {
  const all = await chrome.storage.local.get(null).catch(() => ({}));
  const keys = Object.keys(all).filter((key) => key.startsWith("circlet:storage:"));
  if (keys.length) await chrome.storage.local.remove(keys);
  renderData();
  toast(keys.length ? `Cleared ${keys.length} Circle storage area${keys.length === 1 ? "" : "s"}` : "No Circle storage", "ok");
}

async function exportSettings() {
  const data = JSON.stringify(state.settings, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename: "circlet-settings.json", saveAs: true });
    toast("Settings exported", "ok");
  } catch (error) {
    toast(error?.message || "Export failed", "err");
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

async function importSettings(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    state.settings = await saveSettings(parsed);
    renderAll();
    toast("Settings imported", "ok");
  } catch (error) {
    toast(error?.message || "Invalid settings file", "err");
  }
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

function toast(message, kind) {
  try {
    window.SynteqUI?.toast(message, { kind: kind || "info" });
  } catch {}
}
