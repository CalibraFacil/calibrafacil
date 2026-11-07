/**
 * Narrowing for untyped JSON (request bodies, jsonb columns, third-party payloads). The repo bans
 * `as` assertions, so every reader of unknown data goes through these instead of a local copy.
 */

/** A non-null, non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The object itself, or `{}` when the value is not a plain object. */
export function toRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? Object.fromEntries(Object.entries(value)) : {};
}

/** The plain-object members of an array; anything else yields `[]`. */
export function toRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => (isRecord(item) ? [toRecord(item)] : []));
}
