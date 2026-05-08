function normalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJsonValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
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

export function fingerprintText(text: string, prefix = "cf-fnv1a64"): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return `${prefix}:${hash.toString(16).padStart(16, "0")}`;
}

export function fingerprintJson(value: unknown, prefix?: string): string {
  return fingerprintText(canonicalJson(value), prefix);
}
