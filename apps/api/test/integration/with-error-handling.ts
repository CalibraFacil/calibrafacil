import { Hono, type Env as HonoEnv, type Schema } from "hono";
import type { Env } from "../../src/server/env";
import { applyErrorHandling } from "../../src/server/error-handling";

/**
 * The router behind the app's error handler, as in production: a route throws
 * a `DomainError` (or a `PortalServiceAccountError`) and `app.onError` renders
 * it. A bare router answers a thrown error with Hono's plain 500.
 */
export function withErrorHandling<
  E extends HonoEnv,
  S extends Schema,
  B extends string,
>(router: Hono<E, S, B>) {
  const app = new Hono<{ Bindings: Env }>();
  applyErrorHandling(app);
  app.route("/", router);
  return app;
}
