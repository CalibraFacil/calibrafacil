import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalJson, type CanonicalJsonValue } from "./canonical-json.js";

// Audit fingerprints use SHA-256 (a cryptographic digest with preimage/collision
// resistance) rather than the previous 64-bit FNV-1a, so `calculationFingerprint`
// and friends are sound integrity evidence for ISO 17025 audits. @noble/hashes is
// a pure-JS, synchronous, audited implementation that runs identically across every
// runtime this engine executes in (Node, Bun, the browser preview, the container
// worker) — node:crypto is unavailable in the browser and WebCrypto is async-only,
// so neither could keep these functions synchronous.
export function stableHash(input: string): string {
  return bytesToHex(sha256(utf8ToBytes(input)));
}

export function fingerprintText(text: string, prefix = "sha256"): string {
  return `${prefix}:${stableHash(text)}`;
}

export function fingerprintCanonical(
  value: CanonicalJsonValue,
  prefix = "sha256",
): string {
  return fingerprintText(canonicalJson(value), prefix);
}
