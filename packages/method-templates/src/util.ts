/**
 * Derive a safe method draft id (matches the seed scripts' helper exactly — the
 * draft id is a fingerprint input, so this must not drift).
 */
export function safeMethodId(value: string | number | undefined): string {
  const sanitized = String(value ?? "method_draft").replace(
    /[^a-zA-Z0-9_]/g,
    "_",
  );
  return /^[a-zA-Z]/.test(sanitized) ? sanitized : `method_${sanitized}`;
}

/** Recursively drop `undefined` values (matches the seed scripts' helper). */
export function stripUndefinedDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripUndefinedDeep);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, stripUndefinedDeep(item)]),
  );
}
