import { activeNetwork, loadSettings, setActiveNetwork } from "../core/settings.js";
import { circleUri, parseTarget, resolveTarget } from "../core/octra.js";

const params = new URLSearchParams(location.search);
const raw = params.get("raw") || params.get("u") || "";
const els = {
  network: document.getElementById("networkLabel"),
  title: document.getElementById("resolveTitle"),
  uri: document.getElementById("resolveUri"),
  stepper: document.getElementById("stepper"),
  errorBox: document.getElementById("errorBox"),
  errorMessage: document.getElementById("errorMessage"),
  retry: document.getElementById("retry"),
  copy: document.getElementById("copyRaw")
};

els.retry.addEventListener("click", () => location.reload());
els.copy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(raw);
    window.SynteqUI?.toast("Destination copied", { kind: "ok" });
  } catch {
    window.SynteqUI?.toast("Copy failed", { kind: "err" });
  }
});

resolve().catch((error) => fail(error?.message || "Unable to resolve destination."));

async function resolve() {
  if (!raw) {
    fail("The resolver received no destination.");
    return;
  }
  const requestedNet = params.get("net");
  let settings = await loadSettings();
  if (requestedNet && requestedNet !== settings.activeNetworkId) {
    settings = await setActiveNetwork(requestedNet);
  }
  const network = activeNetwork(settings);
  els.network.textContent = network.name;
  const spec = parseTarget(raw);
  els.title.textContent = spec?.kind === "name" ? spec.name : spec?.kind === "address" ? "Octra Circle address" : "Octra destination";
  els.uri.textContent = spec && spec.kind !== "web" ? circleUri(spec.host, spec.path) : raw;
  setStep(0);

  const target = await resolveTarget(raw, settings, {
    network,
    onProgress(progress) {
      if (progress.stage === "resolving") setStep(1);
      if (progress.stage === "checking" || progress.stage === "resolved") setStep(2);
    }
  });

  if (target.kind === "web") {
    setStep(3);
    location.replace(target.url);
    return;
  }
  if (target.kind === "account") {
    setStep(3);
    if (!target.explorerUrl) throw new Error("This address is not a Circle and no explorer is configured.");
    location.replace(target.explorerUrl);
    return;
  }
  if (target.kind !== "circle") throw new Error("Unsupported Octra destination.");
  setStep(3);
  const viewerParams = new URLSearchParams({
    circleId: target.circleId,
    path: target.path,
    display: target.display,
    mode: target.mode,
    net: network.id
  });
  location.replace(`viewer.html?${viewerParams.toString()}`);
}

function setStep(index) {
  try {
    window.SynteqUI?.setStep(els.stepper, index);
  } catch {}
}

function fail(message) {
  els.errorMessage.textContent = message;
  els.errorBox.hidden = false;
  els.title.textContent = "Resolution failed";
  window.SynteqUI?.setLoading(false);
}
