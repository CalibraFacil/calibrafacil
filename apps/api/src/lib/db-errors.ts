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

/**
 * Walk `error` (and its `.cause` chain) for the `constraint_name` postgres-js
 * sets on a constraint violation. A unique violation on an index reports the
 * index name here.
 */
export function extractPgConstraintName(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("constraint_name" in error && typeof error.constraint_name === "string") {
    return error.constraint_name;
  }
  if ("cause" in error) {
    return extractPgConstraintName(error.cause);
  }
  return undefined;
}

/**
 * True when `error` is a unique_violation raised by the named index or
 * constraint. Use this (not `isUniqueViolation`) when a 23505 on a different
 * index must still surface as a 500.
 */
export function isUniqueViolationOf(
  error: unknown,
  constraintName: string,
): boolean {
  return (
    isUniqueViolation(error) &&
    extractPgConstraintName(error) === constraintName
  );
}
