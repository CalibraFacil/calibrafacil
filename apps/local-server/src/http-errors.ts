import type { Context } from "hono";
import { LocalDomainError, LocalNotFoundError } from "@calibra-facil/local-db";

/**
 * The one place a thrown error becomes an HTTP answer (Hono `onError`).
 *
 * - a domain refusal (`LocalDomainError`, from local-db): 400, or 404 for a
 *   record that is not there, with its message: the person can act on it;
 * - a body that is not JSON, or does not fit its schema: 400;
 * - anything else is our bug (SQLite, a null dereference, a full disk): 500
 *   with a fixed message. The detail goes to the log, not to the screen.
 */
export function handleLocalServerError(error: unknown, c: Context) {
  if (error instanceof LocalNotFoundError) {
    return c.json({ error: error.message }, 404);
  }
  if (error instanceof LocalDomainError) {
    return c.json({ error: error.message }, 400);
  }
  if (isSchemaError(error)) {
    return c.json({ error: "Dados invalidos", issues: error.issues }, 400);
  }
  if (error instanceof SyntaxError) {
    return c.json({ error: "Corpo da requisicao nao e um JSON valido" }, 400);
  }

  console.error("[local-server] unexpected error", error);
  return c.json({ error: "Erro interno do servidor local" }, 500);
}

/** A Zod parse failure (this app does not depend on zod itself, so it is known by name). */
function isSchemaError(error: unknown): error is Error & { issues: unknown } {
  return (
    error instanceof Error &&
    error.name === "ZodError" &&
    Array.isArray(Reflect.get(error, "issues"))
  );
}
