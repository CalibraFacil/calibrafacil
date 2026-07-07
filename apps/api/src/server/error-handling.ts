import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  flushErrorReporter,
  reportServerError,
} from "../lib/observability";
import type { Env } from "./env";

export type ErrorHandlingDeps = {
  report: typeof reportServerError;
  flush: typeof flushErrorReporter;
};

// Uncaught request errors used to fall through to Hono's default handler —
// a plain-text 500 visible only in Vercel logs. Now they are structured-logged
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
      return error.getResponse();
    }

    deps.report(error, {
      surface: "api",
      tags: {
        method: c.req.method,
        // Route pattern when matched; falls back to the raw path.
        path: c.req.routePath || new URL(c.req.url).pathname,
      },
    });
    // Serverless: the function may freeze right after the response — give the
    // delivery a bounded window instead of losing the event.
    await deps.flush();

    return c.json({ error: "Erro interno do servidor" }, 500);
  });
  return app;
}
