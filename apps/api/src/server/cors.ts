import type { Hono } from "hono";
import { cors } from "hono/cors";
import { isAllowedPortalOrigin } from "../lib/portal-domains";
import type { Env } from "./env";

function originOf(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    return new URL(value.trim()).origin;
  } catch {
    return null;
  }
}

// Browser origins allowed to call the API with credentials: the desktop shell,
// the configured deployment (APP_URL, PORTAL_APP_URL, SITE_URL, API_URL,
// VERIFY_URL) and any extra origins in CORS_ALLOWED_ORIGINS (comma-separated).
// Read per request so tests and runtimes that inject env late still apply.
function configuredAllowedOrigins(env?: Env): Set<string> {
  const read = (name: string): string | undefined => {
    const fromBindings = env?.[name];
    return typeof fromBindings === "string" ? fromBindings : process.env[name];
  };
  const extra = (read("CORS_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((entry) => originOf(entry))
    .filter((origin): origin is string => origin !== null);

  return new Set(
    [
      "app://calibra-facil",
      originOf(read("APP_URL")),
      originOf(read("PORTAL_APP_URL")),
      originOf(read("SITE_URL")),
      originOf(read("API_URL")),
      originOf(read("VERIFY_URL")),
      ...extra,
    ].filter((origin): origin is string => origin !== null),
  );
}

function isPrivateDevOrigin(origin: string, nodeEnv?: string): boolean {
  if ((nodeEnv ?? "production") !== "development") return false;

  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    const port = url.port;
    const parts = hostname.split(".").map((part) => Number(part));
    const [first = -1, second = -1] = parts;
    const isIpv4 =
      parts.length === 4 && parts.every((part) => part >= 0 && part <= 255);
    const isPrivateIpv4 =
      isIpv4 &&
      (first === 10 ||
        first === 127 ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168));

    return (
      url.protocol === "http:" &&
      (hostname === "localhost" || isPrivateIpv4) &&
      (port === "5173" || port === "5174" || port === "5175")
    );
  } catch {
    return false;
  }
}

export async function getCorsOrigin(origin?: string, env?: Env) {
  if (!origin) return undefined;
  if (configuredAllowedOrigins(env).has(origin)) return origin;
  if (isPrivateDevOrigin(origin, env?.NODE_ENV)) return origin;
  return (await isAllowedPortalOrigin(origin)) ? origin : undefined;
}

export function applyCors(app: Hono<{ Bindings: Env }>) {
  app.use(
    "*",
    cors({
      origin: (origin, c) => getCorsOrigin(origin, c.env),
      credentials: true,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "x-active-unit-id"],
    }),
  );
}
