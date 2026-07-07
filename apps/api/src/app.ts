import { Hono } from "hono";
import { applyCors } from "./server/cors";
import { applyErrorHandling } from "./server/error-handling";
import { applyRuntimeEnv } from "./server/runtime-env";
import { applySecurityHeaders } from "./server/security-headers";
import { mountAuthRoutes } from "./server/auth-routes";
import { mountApiRoutes } from "./server/route-mounts";
import type { Env } from "./server/env";

export function createApiApp() {
  const app = new Hono<{ Bindings: Env }>();

  applyCors(app);
  applySecurityHeaders(app);
  applyRuntimeEnv(app);
  applyErrorHandling(app);
  mountAuthRoutes(app);

  return mountApiRoutes(app);
}
