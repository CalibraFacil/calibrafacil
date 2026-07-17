import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

/**
 * Deterministic JSON serialization: object keys sorted recursively, arrays in
 * order, primitives via JSON.stringify. This is what `documentSha256` and
 * `compiledHtmlSha256` provenance hang off, so it must never depend on
 * insertion order, runtime, or locale (same rationale as
 * `packages/math-engine/src/audit/canonical-json.ts`).
 *
 * Non-JSON values are hard errors, never silently coerced: a template hash
 * computed over lossy data would be worthless as audit evidence.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error(`canonicalJsonStringify: non-finite number ${value}`);
      }
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new Error(`canonicalJsonStringify: unsupported type ${typeof value}`);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonStringify(item === undefined ? null : item)).join(",")}]`;
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const record = entries.map(
    ([k, v]) => `${JSON.stringify(k)}:${canonicalJsonStringify(v)}`,
  );
  return `{${record.join(",")}}`;
}

export function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)));
}

/** Content hash of a certificate template document (spec 02 §1 rule 3). */
export function hashCertificateDocument(documentJson: unknown): string {
  return sha256Hex(canonicalJsonStringify(documentJson));
}
