import { stableHash } from "@calibra-facil/math-engine";

function normalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJsonValue);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = Object.fromEntries(Object.entries(value));
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (item !== undefined) normalized[key] = normalizeJsonValue(item);
    }
    return normalized;
  }
  if (typeof value === "number" && Object.is(value, -0)) return 0;
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeJsonValue(value));
}

// Uses the same SHA-256 digest as @calibra-facil/math-engine's audit fingerprints
// (previously a separate 64-bit FNV-1a) so method-level and engine-level audit
// fingerprints share one cryptographic hash. For finite JSON data the canonical
// form above is byte-identical to the engine's canonicalJson (V8 number formatting
// equals the shortest round-trip form), keeping the two families consistent.
export function fingerprintText(text: string, prefix = "cf-sha256"): string {
  return `${prefix}:${stableHash(text)}`;
}

export function fingerprintJson(value: unknown, prefix?: string): string {
  return fingerprintText(canonicalJson(value), prefix);
}
