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

const app = new Hono();

const allowedOrigins = [
  "https://localhost:5173",
  "https://localhost:5174",
  "https://192.168.0.10:5173",
  "https://192.168.0.10:5174",
];

// CORS middleware - must be before auth routes
app.use(
  "/api/auth/*",
  cors({
    origin: (origin) => {
      if (allowedOrigins.includes(origin)) {
        return origin;
      }
      return origin ? "" : allowedOrigins[0];
    },
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  }),
);

// Explicit OPTIONS handler for preflight requests
app.options("/api/auth/*", (c) => {
  const origin = c.req.header("Origin");
  if (origin && allowedOrigins.includes(origin)) {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Max-Age": "600",
      },
    });
  }
  return new Response(null, { status: 403 });
});

// Lab Auth handler - for dashboard app (apps/web)
app.on(["POST", "GET"], "/api/auth/lab/*", async (c) => {
  const response = await labAuth.handler(c.req.raw);

  // Add CORS headers to Better Auth response
  const origin = c.req.header("Origin");
  if (origin && allowedOrigins.includes(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Credentials", "true");
  }

  return response;
});

// Portal Auth handler - for client portal app (apps/portal)
app.on(["POST", "GET"], "/api/auth/portal/*", async (c) => {
  const response = await portalAuth.handler(c.req.raw);

  // Add CORS headers to Better Auth response
  const origin = c.req.header("Origin");
  if (origin && allowedOrigins.includes(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Credentials", "true");
  }

  return response;
});

// Other routes with their own CORS if needed
app.use(
  "*",
  cors({
    origin: (origin) => {
      if (allowedOrigins.includes(origin)) {
        return origin;
      }
      return origin ? "" : allowedOrigins[0];
    },
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  }),
);

// API Routes
const routes = app
  .get("/hello", (c) => {
    return c.json({ message: "Hello!" });
  })
  .route("/api/customers", customersRouter)
  .route("/api/invitations", invitationsRouter)
  .route("/api/portal", portalRouter)
  .route("/api/assets", assetsRouter)
  .route("/api/asset-types", assetTypesRouter)
  .route("/api/methods", methodsRouter)
  .route("/api/services", servicesRouter);

export type AppType = typeof routes;
export default {
  port: 3000,
  fetch: app.fetch,
  tls: {
    key: Bun.file("./certs/key.pem"),
    cert: Bun.file("./certs/cert.pem"),
  },
};
