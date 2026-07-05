// Postgres error-code detection for route handlers.
//
// postgres-js (Neon prod + the integration Docker harness) surfaces a duplicate
// insert/update as a Drizzle `DrizzleQueryError` wrapper whose OWN `code` is
// undefined — the real SQLSTATE (`23505` for unique_violation) lives on
// `error.cause`. Unwrap recursively so both the bare `PostgresError` and the
// wrapped `DrizzleQueryError` are recognized. Mirrors the pattern already used
// in routes/materials.ts and services/commercial/reconcile-webhook.ts.

/** Walk `error` (and its `.cause` chain) for a string `code` property. */
export function extractPgErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error && typeof error.code === "string") {
    return error.code;
  }
  if ("cause" in error) {
    return extractPgErrorCode(error.cause);
  }
  return undefined;
}

/** True when `error` is a Postgres unique_violation (SQLSTATE 23505). */
export function isUniqueViolation(error: unknown): boolean {
  return extractPgErrorCode(error) === "23505";
}
