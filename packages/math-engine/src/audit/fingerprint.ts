import { canonicalJson, type CanonicalJsonValue } from "./canonical-json.js";

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const FNV_MASK = 0xffffffffffffffffn;

export function stableHash(input: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * FNV_PRIME) & FNV_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

export function fingerprintText(text: string, prefix = "fnv1a64"): string {
  return `${prefix}:${stableHash(text)}`;
}

export function fingerprintCanonical(value: CanonicalJsonValue, prefix = "fnv1a64"): string {
  return fingerprintText(canonicalJson(value), prefix);
}
