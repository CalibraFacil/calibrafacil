import { rawEnv, readOriginsConfig } from "@calibra-facil/config";
import type { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env";

function originOf(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    return new URL(value.trim()).origin;
  } catch {
    return null;
  }
}

const ORIGIN_SETTINGS = [
  "APP_URL",
  "PORTAL_APP_URL",
  "SITE_URL",
  "API_URL",
  "VERIFY_URL",
  "CORS_ALLOWED_ORIGINS",
] as const;

// Browser origins allowed to call the API with credentials: the desktop shell,
// the configured deployment (APP_URL, PORTAL_APP_URL, SITE_URL, API_URL,
// VERIFY_URL) and any extra origins in CORS_ALLOWED_ORIGINS (comma-separated).
// Read per request so tests and runtimes that inject env late still apply; a
// binding wins over the process environment.
function configuredAllowedOrigins(env?: Env): Set<string> {
  const processEnv = rawEnv();
  const source: Record<string, string | undefined> = {};
  for (const name of ORIGIN_SETTINGS) {
    const fromBindings = env ? Reflect.get(env, name) : undefined;
    source[name] =
      typeof fromBindings === "string" ? fromBindings : processEnv[name];
  }

  let origins: ReturnType<typeof readOriginsConfig> | null = null;
  try {
    origins = readOriginsConfig(source);
  } catch {
    // A malformed address is reported once, at start-up; here it allows nothing.
  }
  if (!origins) return new Set(["app://calibra-facil"]);

  const extra = origins.corsAllowedOrigins
    .map((entry) => originOf(entry))
    .filter((origin): origin is string => origin !== null);

  return new Set(
    [
      "app://calibra-facil",
      originOf(origins.appUrl),
      originOf(origins.portalAppUrl),
      originOf(origins.siteUrl),
      originOf(origins.apiUrl),
      originOf(origins.verifyUrl),
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

/**
 * The origins allowed to call the API with credentials: the configured app and
 * portal addresses (plus the desktop shell and, in development, the local dev
 * servers). Nothing else (roadmap 2 D1, review 3.3).
 *
 * A laboratory's verified custom portal domain is NOT one of them: credentialed
 * CORS for every such domain let whoever controls one read and write the API as
 * any visitor. A custom portal domain is served with the API under its own
 * `/api` (the reverse proxy forwards it, as the Caddy of deploy/compose.yaml does
 * for the app and the portal), so its requests are same-origin and need no CORS.
 */
export async function getCorsOrigin(origin?: string, env?: Env) {
  if (!origin) return undefined;
  if (configuredAllowedOrigins(env).has(origin)) return origin;
  if (isPrivateDevOrigin(origin, env?.NODE_ENV)) return origin;
  return undefined;
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
