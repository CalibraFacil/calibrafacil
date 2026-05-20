import type { Hono } from "hono";
import {
  rateLimitAuth,
  rateLimitInvitations,
  rateLimitPublicApi,
  rateLimitVerify,
  rateLimitWebhooks,
} from "../middleware/rate-limit";
import type { Env } from "./env";

export function applyRateLimits(app: Hono<{ Bindings: Env }>) {
  app.use("/api/auth/*", rateLimitAuth);
  app.use("/api/sso/start", rateLimitAuth);
  app.use("/api/invitations/*", rateLimitInvitations);
  app.use("/api/verify/*", rateLimitVerify);
  app.use("/api/webhooks/asaas", rateLimitWebhooks);
  app.use("/api/public/*", rateLimitPublicApi);
}
