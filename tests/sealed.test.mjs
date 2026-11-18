import assert from "node:assert/strict";
import { decryptSealedBytes, sha256Hex } from "../src/core/octra.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const hex = (bytes) => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const circleId = "oct3A5bhpktxb9y2gepQeGxSbkJspq3Pv178Zyi9tkM1oJx";
const keyId = "ab".repeat(32);
const passphrase = "correct horse battery staple";
const plaintext = encoder.encode("<!doctype html><title>sealed</title><h1>secret</h1>");

function frame(bytes) {
  const out = new Uint8Array(bytes.length + 4);
  out[0] = (bytes.length >>> 24) & 0xff;
  out[1] = (bytes.length >>> 16) & 0xff;
  out[2] = (bytes.length >>> 8) & 0xff;
  out[3] = bytes.length & 0xff;
  out.set(bytes, 4);
  return out;
}

async function importMaterial(pass) {
  return crypto.subtle.importKey("raw", encoder.encode(pass), "PBKDF2", false, ["deriveKey"]);
}

async function deriveAesKey(pass, saltText) {
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: encoder.encode(saltText), iterations: 120000, hash: "SHA-256" },
    await importMaterial(pass),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
}

async function deriveHmacKey(pass, saltText) {
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: encoder.encode(saltText), iterations: 120000, hash: "SHA-256" },
    await importMaterial(pass),
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"]
  );
}

async function keyedDigest(pass, saltText, bytes) {
  const key = await deriveHmacKey(pass, saltText);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes)));
}

function envelope(nonce, cipher) {
  const magic = encoder.encode("OCRS1");
  const out = new Uint8Array(magic.length + nonce.length + cipher.length);
  out.set(magic, 0);
  out.set(nonce, magic.length);
  out.set(cipher, magic.length + nonce.length);
  return out;
}

function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const salt = `octra:circle:sealed_read:v1:${circleId}:${keyId}`;
const aesKey = await deriveAesKey(passphrase, salt);
const nonce = crypto.getRandomValues(new Uint8Array(12));
const cipher = new Uint8Array(await crypto.subtle.encrypt(
  { name: "AES-GCM", iv: nonce, tagLength: 128 },
  aesKey,
  frame(plaintext)
));
const ciphertextB64 = toBase64(envelope(nonce, cipher));

const shaAsset = {
  key_id: keyId,
  plaintext_hash: await sha256Hex(plaintext),
  ciphertext_b64: ciphertextB64
};
const keyedAsset = {
  key_id: keyId,
  plaintext_hash: await keyedDigest(
    passphrase,
    JSON.stringify(["octra:circle:sealed_digest", circleId, keyId]),
    plaintext
  ),
  ciphertext_b64: ciphertextB64
};

const shaPlain = await decryptSealedBytes(circleId, shaAsset, passphrase);
assert.equal(decoder.decode(shaPlain), decoder.decode(plaintext), "SHA-256 digest mode");

const keyedPlain = await decryptSealedBytes(circleId, keyedAsset, passphrase);
assert.equal(decoder.decode(keyedPlain), decoder.decode(plaintext), "keyed digest mode");

await assert.rejects(
  () => decryptSealedBytes(circleId, shaAsset, "wrong passphrase"),
  /passphrase/i,
  "wrong passphrase is rejected"
);

await assert.rejects(
  () => decryptSealedBytes(circleId, { ...shaAsset, plaintext_hash: "0".repeat(64) }, passphrase),
  /integrity|failed/i,
  "tampered payload is rejected"
);

console.log("sealed.test.mjs: PASS");
