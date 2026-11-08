import type { ApiErrorCode } from "@calibra-facil/contracts";
import { IllegalTransitionError } from "@calibra-facil/schemas/state-machine";
import type { Env as HonoEnv, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { extractPgErrorCode } from "../lib/db-errors";
import { PortalServiceAccountError } from "../lib/portal-service-account-error";
import { DomainError, domainErrorBody } from "../lib/domain-errors";
import { flushErrorReporter, reportServerError } from "../lib/observability";

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
function httpExceptionBody(error: HTTPException): {
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

// Uncaught request errors are structured-logged and reported before a generic
// JSON 500 is returned (not Hono's plain-text default). Intentional
// HTTP errors (HTTPException 4xx/5xx thrown by routes) pass through untouched:
// they are control flow, not defects.
export function applyErrorHandling<E extends HonoEnv>(
  app: Hono<E>,
  deps: ErrorHandlingDeps = {
    report: reportServerError,
    flush: flushErrorReporter,
  },
): Hono<E> {
  app.onError(async (error, c) => {
    if (error instanceof HTTPException) {
      // A response the route built itself (a domain body, a challenge) is kept;
      // otherwise the same JSON shape as every other failure, never plain text.
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

    // The portal service account refused (the CLIENT organization's membership
    // rules, a duplicate invitation): its own status and code.
    if (error instanceof PortalServiceAccountError) {
      return c.json(
        { error: error.message, code: error.code },
        portalServiceStatus(error.status),
      );
    }

    // A command its state machine does not allow from the record's current
    // state (`requireTransition` / `requireTargetOf`): the client asked for a
    // move that does not exist, not a defect.
    if (error instanceof IllegalTransitionError) {
      return c.json(
        {
          error: `Operação não permitida na situação atual (${error.from ?? "nova"}).`,
          code: "status_transition_conflict",
        },
        409,
      );
    }

    reportDefect();
    // Give the report's delivery a bounded window before the handler returns.
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

    // CF001 comes only from the status guards generated from the state machines
    // (migrations 0119/0139/0140): a writer tried a move its machine does not
    // list. Reported above as a defect; the client gets a conflict.
    if (extractPgErrorCode(error) === "CF001") {
      return c.json(
        {
          error:
            "O registro mudou de situação durante a operação. Recarregue e tente novamente.",
          code: "status_transition_conflict",
        },
        409,
      );
    }

    return c.json({ error: "Erro interno do servidor" }, 500);
  });
  return app;
}

function portalServiceStatus(
  status: number,
): 400 | 401 | 403 | 404 | 409 | 500 {
  return status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 409
    ? status
    : 500;
}
