import type { ApiErrorCode } from "@calibra-facil/contracts";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { extractPgErrorCode } from "../lib/db-errors";
import { DomainError, domainErrorBody } from "../lib/domain-errors";
import { flushErrorReporter, reportServerError } from "../lib/observability";
import type { Env } from "./env";

const STATUS_CODES: Partial<Record<number, ApiErrorCode>> = {
  400: "invalid_request",
  401: "unauthenticated",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  422: "unprocessable",
};

const STATUS_MESSAGES: Partial<Record<number, string>> = {
  400: "Requisição inválida",
  401: "Não autenticado",
  403: "Acesso negado",
  404: "Não encontrado",
  409: "Conflito",
  422: "Não foi possível processar",
};

/** `{ error, code }` for an HTTPException thrown without a body of its own. */
export function httpExceptionBody(error: HTTPException): {
  error: string;
  code?: ApiErrorCode;
} {
  const message =
    error.message || STATUS_MESSAGES[error.status] || "Erro na requisição";
  const code = STATUS_CODES[error.status];
  return code ? { error: message, code } : { error: message };
}

export type ErrorHandlingDeps = {
  report: typeof reportServerError;
  flush: typeof flushErrorReporter;
};

// Uncaught request errors used to fall through to Hono's default handler —
// a plain-text 500 visible only in the process logs. Now they are structured-logged
// and reported before returning a generic JSON 500. Intentional
// HTTP errors (HTTPException 4xx/5xx thrown by routes) pass through untouched:
// they are control flow, not defects.
export function applyErrorHandling(
  app: Hono<{ Bindings: Env }>,
  deps: ErrorHandlingDeps = {
    report: reportServerError,
    flush: flushErrorReporter,
  },
): Hono<{ Bindings: Env }> {
  app.onError(async (error, c) => {
    if (error instanceof HTTPException) {
      // A response the route built itself (a domain body, a challenge) is kept;
      // otherwise the same JSON shape as every other failure, never plain text
      // (roadmap 2 D2).
      if (error.res) return error.getResponse();
      return c.json(httpExceptionBody(error), error.status);
    }

    const reportDefect = () =>
      deps.report(error, {
        surface: "api",
        tags: {
          method: c.req.method,
          // Route pattern when matched; falls back to the raw path.
          path: c.req.routePath || new URL(c.req.url).pathname,
        },
      });

    // Typed domain failures (throw notFound(...), conflict(...), ...) are
    // expected outcomes: mapped once to { error, code, details? } and NOT
    // reported — unless the error itself carries a 5xx status.
    if (error instanceof DomainError) {
      if (error.status >= 500) {
        reportDefect();
        await deps.flush();
      }
      return c.json(domainErrorBody(error), error.status);
    }

    reportDefect();
    // Serverless: the function may freeze right after the response — give the
    // delivery a bounded window instead of losing the event.
    await deps.flush();

    // P0001 comes only from the immutability triggers (migration 0115): the
    // write raced an approval or a route missed its status guard. Reported
    // above as a defect, but the client gets a conflict, not a crash.
    if (extractPgErrorCode(error) === "P0001") {
      return c.json(
        {
          error: "Registro emitido ou de auditoria não pode ser alterado",
          code: "record_immutable",
        },
        409,
      );
    }

    return c.json({ error: "Erro interno do servidor" }, 500);
  });
  return app;
}
