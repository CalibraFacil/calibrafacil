import { Hono } from "hono";
import { applyBodyLimit } from "./server/body-limit";
import { applyCors } from "./server/cors";
import { applyRequestObservability } from "./server/observability";
import { applyValidationErrorShape } from "./server/validation-error-shape";
import { applyOriginGuard } from "./server/origin-guard";
import { applyRateLimit } from "./server/rate-limit";
import { applyErrorHandling } from "./server/error-handling";
import { applyRuntimeEnv } from "./server/runtime-env";
import { applySecurityHeaders } from "./server/security-headers";
import { mountAuthRoutes } from "./server/auth-routes";
import { mountApiRoutes } from "./server/route-mounts";
import type { Env } from "./server/env";

export function createApiApp() {
  const app = new Hono<{ Bindings: Env }>();

  // First, so the request id, the access log and the counters see every answer
  // (including a CORS preflight, a 403 of the origin guard or a 429).
  applyRequestObservability(app);
  applyCors(app);
  applySecurityHeaders(app);
  applyOriginGuard(app);
  applyRateLimit(app);
  applyBodyLimit(app);
  applyRuntimeEnv(app);
  applyErrorHandling(app);
  applyValidationErrorShape(app);
  mountAuthRoutes(app);

  return mountApiRoutes(app);
}
