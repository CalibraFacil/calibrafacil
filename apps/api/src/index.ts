import { Hono } from "hono";
import { cors } from "hono/cors";
import { createLabAuth, createPortalAuth } from "@calibra-facil/auth";
import {
  rateLimitAuth,
  rateLimitInvitations,
  rateLimitPublicApi,
  rateLimitVerify,
  rateLimitWebhooks,
} from "./middleware/rate-limit";

import { customersRouter } from "./routes/customers";
import { invitationsRouter } from "./routes/invitations";
import { portalRouter } from "./routes/portal";
import { portalRequestsRouter } from "./routes/portal-requests";
import { assetsRouter } from "./routes/assets";
import { assetTypesRouter } from "./routes/asset-types";
import { methodsRouter } from "./routes/methods";
import { servicesRouter } from "./routes/services";
import { standardsRouter } from "./routes/standards";
import { jobsRouter } from "./routes/jobs";
import { calibrationRequestsRouter } from "./routes/calibration-requests";
import { verifyRouter } from "./routes/verify";
import { dashboardRouter } from "./routes/dashboard";
import { billingRouter } from "./routes/billing";
import { webhooksRouter } from "./routes/webhooks";
import { notificationsRouter } from "./routes/notifications";
import { signaturesRouter } from "./routes/signatures";
import { signingRouter } from "./routes/signing";
import { nonConformancesRouter } from "./routes/non-conformances";
import { capaRouter } from "./routes/capa";
import { environmentalLimitsRouter } from "./routes/environmental-limits";
import { competencesRouter } from "./routes/competences";
import { trainingRecordsRouter } from "./routes/training-records";
import { sessionsRouter } from "./routes/sessions";
import { ssoRouter } from "./routes/sso";
import { apiKeysRouter } from "./routes/api-keys";
import { publicApiRouter } from "./routes/public-api";
import { isAllowedPortalOrigin } from "./lib/portal-domains";
import { portalDomainsRouter } from "./routes/portal-domains";
import { certificateTemplatesRouter } from "./routes/certificate-templates";

// Environment variables type for Cloudflare Workers
interface Env {
  NODE_ENV: string;
  API_URL: string;
  APP_URL: string;
  BETTER_AUTH_SECRET: string;
  RESEND_FROM_EMAIL: string;
  RESEND_API_KEY: string;
  PORTAL_SERVICE_USER_ID: string;
  PORTAL_APP_URL?: string;
  PORTAL_INVITATION_EXPIRES_IN?: string;
  DATABASE_URL: string;
  CACHE: KVNamespace;
  [key: string]: unknown;
}

const app = new Hono<{ Bindings: Env }>();

const allowedOrigins = new Set([
  "https://localhost:5173",
  "https://localhost:5174",
  "https://192.168.0.10:5173",
  "https://192.168.0.10:5174",
  "https://calibrafacil.com",
  "https://portal.calibrafacil.com",
  "https://api.calibrafacil.com",
]);

async function getCorsOrigin(origin?: string) {
  if (!origin) return undefined;
  if (allowedOrigins.has(origin)) return origin;
  return (await isAllowedPortalOrigin(origin)) ? origin : undefined;
}

/**
 * GLOBAL CORS
 */
app.use(
  "*",
  cors({
    origin: (origin) => getCorsOrigin(origin),
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

/**
 * SECURITY HEADERS
 */
app.use("*", async (c, next) => {
  await next();

  if ((c.env.NODE_ENV ?? "").toLowerCase() === "production") {
    c.header(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload",
    );
  }

  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
  c.header(
    "Permissions-Policy",
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  );
  c.header(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  );
});

/**
 * Middleware: Inject Cloudflare env into process.env for packages that use it
 * Also inject Hyperdrive connection string for database package
 */
app.use("*", async (c, next) => {
  // Inject string env vars
  for (const [key, value] of Object.entries(c.env)) {
    if (typeof value === "string") {
      process.env[key] = value;
    }
  }

  // Inject Hyperdrive connection string if available
  const hyperdrive = c.env.HYPERDRIVE as
    | { connectionString?: string }
    | undefined;
  if (hyperdrive?.connectionString) {
    process.env.HYPERDRIVE_URL = hyperdrive.connectionString;
  }

  await next();
});

/**
 * RATE LIMITING
 */
app.use("/api/auth/*", rateLimitAuth);
app.use("/api/sso/start", rateLimitAuth);
app.use("/api/invitations/*", rateLimitInvitations);
app.use("/api/verify/*", rateLimitVerify);
app.use("/api/webhooks/asaas", rateLimitWebhooks);
app.use("/api/public/*", rateLimitPublicApi);

/**
 * Helper: attach CORS headers to Better Auth responses
 */
function withCors(c: any, res: Response) {
  return (async () => {
    const origin = await getCorsOrigin(c.req.header("Origin"));
    if (!origin) return res;

    const headers = new Headers(res.headers);
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.append("Vary", "Origin");

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  })();
}

/**
 * AUTH ROUTES
 */
app.on(["GET", "POST"], "/api/auth/lab/*", async (c) => {
  const labAuth = createLabAuth();
  const res = await labAuth.handler(c.req.raw);
  return await withCors(c, res);
});

app.on(["GET", "POST"], "/api/auth/portal/*", async (c) => {
  const portalAuth = createPortalAuth();
  const res = await portalAuth.handler(c.req.raw);
  return await withCors(c, res);
});

/**
 * API ROUTES
 */
const routes = app
  .get("/hello", (c) => c.json({ message: "Hello!" }))
  .route("/api/customers", customersRouter)
  .route("/api/invitations", invitationsRouter)
  .route("/api/portal", portalRouter)
  .route("/api/portal/requests", portalRequestsRouter)
  .route("/api/assets", assetsRouter)
  .route("/api/asset-types", assetTypesRouter)
  .route("/api/methods", methodsRouter)
  .route("/api/services", servicesRouter)
  .route("/api/standards", standardsRouter)
  .route("/api/jobs", jobsRouter)
  .route("/api/calibration-requests", calibrationRequestsRouter)
  .route("/api/verify", verifyRouter)
  .route("/api/dashboard", dashboardRouter)
  .route("/api/billing", billingRouter)
  .route("/api/webhooks", webhooksRouter)
  .route("/api/notifications", notificationsRouter)
  .route("/api/signatures", signaturesRouter)
  .route("/api/signing", signingRouter)
  .route("/api/nc", nonConformancesRouter)
  .route("/api/capa", capaRouter)
  .route("/api/environmental-limits", environmentalLimitsRouter)
  .route("/api/competences", competencesRouter)
  .route("/api/training-records", trainingRecordsRouter)
  .route("/api/sessions", sessionsRouter)
  .route("/api/sso", ssoRouter)
  .route("/api/api-keys", apiKeysRouter)
  .route("/api/portal-domains", portalDomainsRouter)
  .route("/api/certificate-templates", certificateTemplatesRouter)
  .route("/api/public/v1", publicApiRouter);

export type AppType = typeof routes;

// Export the Hono app for Cloudflare Workers
export default app;
