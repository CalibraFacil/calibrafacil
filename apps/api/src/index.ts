import type { ExecutionContext } from "@cloudflare/workers-types";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { labAuth, portalAuth } from "@calibra-facil/auth";

import { customersRouter } from "./routes/customers";
import { invitationsRouter } from "./routes/invitations";
import { portalRouter } from "./routes/portal";
import { assetsRouter } from "./routes/assets";
import { assetTypesRouter } from "./routes/asset-types";
import { methodsRouter } from "./routes/methods";
import { servicesRouter } from "./routes/services";
import { standardsRouter } from "./routes/standards";
import { jobsRouter } from "./routes/jobs";

const app = new Hono();

const allowedOrigins = new Set([
  "https://localhost:5173",
  "https://localhost:5174",
  "https://192.168.0.10:5173",
  "https://192.168.0.10:5174",
  "https://dashboard.calibrafacil.com",
  "https://portal.calibrafacil.com",
  "https://api.calibrafacil.com",
]);

function getCorsOrigin(origin?: string) {
  if (!origin) return undefined;
  return allowedOrigins.has(origin) ? origin : undefined;
}

/**
 * GLOBAL CORS
 * - Handles OPTIONS automatically
 * - Applies to ALL routes
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
 * Helper: attach CORS headers to Better Auth responses
 */
function withCors(c: any, res: Response) {
  const origin = getCorsOrigin(c.req.header("Origin"));
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
}

/**
 * AUTH ROUTES
 */
app.on(["GET", "POST"], "/api/auth/lab/*", async (c) => {
  const res = await labAuth.handler(c.req.raw);
  return withCors(c, res);
});

app.on(["GET", "POST"], "/api/auth/portal/*", async (c) => {
  const res = await portalAuth.handler(c.req.raw);
  return withCors(c, res);
});

/**
 * API ROUTES
 */
const routes = app
  .get("/hello", (c) => c.json({ message: "Hello!" }))
  .route("/api/customers", customersRouter)
  .route("/api/invitations", invitationsRouter)
  .route("/api/portal", portalRouter)
  .route("/api/assets", assetsRouter)
  .route("/api/asset-types", assetTypesRouter)
  .route("/api/methods", methodsRouter)
  .route("/api/services", servicesRouter)
  .route("/api/standards", standardsRouter)
  .route("/api/jobs", jobsRouter);

export type AppType = typeof routes;

/**
 * Bun (local dev) vs Cloudflare Workers (prod)
 */
const isBun = typeof Bun !== "undefined";

export default isBun
  ? {
    port: 3000,
    fetch: app.fetch,
    tls: {
      key: Bun.file("./certs/key.pem"),
      cert: Bun.file("./certs/cert.pem"),
    },
  }
  : {
    fetch: (request: Request, env: Record<string, string>, ctx: ExecutionContext) => {
      // Inject Cloudflare Worker env vars into process.env for packages that use it
      for (const [key, value] of Object.entries(env)) {
        if (typeof value === "string") {
          process.env[key] = value;
        }
      }
      return app.fetch(request, env, ctx);
    },
  };
