import assert from "node:assert/strict";
import {
  circleInfo,
  fetchCircleAsset,
  nodeStatus,
  resolveName,
  resolveTarget
} from "../src/core/octra.js";

const network = {
  id: "devnet",
  name: "Octra Devnet",
  type: "devnet",
  rpcUrls: (process.env.OCTRA_RPC_URL || "https://devnet.octrascan.io/rpc").split(","),
  explorer: "https://devnet.octrascan.io",
  identity: "oct2Tdnmgh8qtvhC82W9VhoRJcLkAhNRCbnEEPhCUPX5b7m"
};
const settings = { activeNetworkId: "devnet", networks: [network], recent: [] };
const sample = "oct3A5bhpktxb9y2gepQeGxSbkJspq3Pv178Zyi9tkM1oJx";

const status = await nodeStatus(network);
assert.ok(Number.isFinite(Number(status.epoch)), "node_status returns an epoch");
console.log(`node_status: epoch ${status.epoch}, ${status.latencyMs} ms`);

const info = await circleInfo(network, sample, { force: true });
assert.equal(info.privacy_class, "public", "sample Circle is public");
assert.equal(info.runtime, "octb", "sample Circle uses the octb runtime");
console.log(`circle_info: ${info.runtime} / ${info.resource_mode}`);

const index = await fetchCircleAsset(network, sample, "/index.html", { force: true });
assert.ok(index.body.byteLength > 1000, "index.html has content");
assert.match(index.contentType, /html/, "index.html has an HTML content type");
console.log(`circle_asset: /index.html ${index.body.byteLength} bytes`);

const resolved = await resolveName(network, "poctra.oct");
assert.equal(resolved, sample, "poctra.oct resolves to the sample Circle");
console.log(`resolve_name: poctra.oct -> ${resolved}`);

const target = await resolveTarget("poctra.oct", settings, { network });
assert.equal(target.kind, "circle", "resolveTarget returns a Circle");
assert.equal(target.mode, "public", "resolved Circle is public");
console.log(`resolveTarget: ${target.display} (${target.mode})`);

console.log("live-rpc.mjs: PASS");
