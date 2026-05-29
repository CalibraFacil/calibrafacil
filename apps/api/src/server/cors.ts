import type { Hono } from "hono";
import { cors } from "hono/cors";
import { isAllowedPortalOrigin } from "../lib/portal-domains";
import type { Env } from "./env";

const allowedOrigins = new Set([
  "app://calibra-facil",
  "https://calibrafacil.com",
  "https://portal.calibrafacil.com",
  "https://verify.calibrafacil.com",
  "https://api.calibrafacil.com",
  "https://dev-web.calibrafacil.com",
  "https://dev-portal.calibrafacil.com",
  "https://dev-api.calibrafacil.com",
]);

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
      (port === "5173" || port === "5174")
    );
  } catch {
    return false;
  }
}

export async function getCorsOrigin(origin?: string, env?: Env) {
  if (!origin) return undefined;
  if (allowedOrigins.has(origin)) return origin;
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
