import { readRuntimeConfig } from "@calibra-facil/config";
import type { Context, Hono } from "hono";
import { clientIp } from "../lib/client-ip";
import type { Env } from "./env";

/**
 * Request rate limits (roadmap 2 D1, review 3.3): one fixed one-minute window per
 * caller, answered 429 with `Retry-After` once spent.
 *
 * The caller is, in order: the API key of a public API request, the session
 * cookie of a signed-in browser, else the client address (lib/client-ip.ts). The
 * unauthenticated endpoints (certificate verification, magic links, sign-up, the
 * out-of-tolerance acknowledgement, service-order access codes) have a stricter
 * limit of their own, per client address.
 *
 * The counters live in this process: each API replica counts on its own, so the
 * effective limit is the configured one times the number of replicas. That is the
 * deliberate trade-off for a self-hosted deployment of one or two replicas; a
 * shared limiter would need a shared store.
 */
export function applyRateLimit(app: Hono<{ Bindings: Env }>) {
  const limiter = new FixedWindowLimiter();
  app.use("/api/*", async (c, next) => {
    const decision = limiter.hit(limitKeyOf(c), Date.now());
    if (decision.limited) {
      c.header("Retry-After", String(decision.retryAfterSeconds));
      return c.json(
        {
          error:
            "Muitas requisições em pouco tempo. Aguarde um instante e tente de novo.",
          code: "RATE_LIMITED",
        },
        429,
      );
    }
    await next();
  });
}

const WINDOW_MS = 60_000;

/** The endpoints a visitor reaches without signing in. */
const PUBLIC_PREFIXES = [
  "/api/verify",
  "/api/magic-link",
  "/api/public/signup",
  "/api/public/oot-ack",
  "/api/public/service-order-access",
];

type LimitKey = { key: string; limit: number } | null;

export function limitKeyOf(c: Context<{ Bindings: Env }>): LimitKey {
  const { pathname } = new URL(c.req.url);
  if (pathname === "/api/health") return null;
  const config = readRuntimeConfig();

  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    const ip = clientIp(c);
    return ip && config.publicRateLimitPerMinute > 0
      ? { key: `public:${ip}`, limit: config.publicRateLimitPerMinute }
      : null;
  }
  if (config.rateLimitPerMinute === 0) return null;

  const apiKey =
    c.req.header("x-api-key") ?? bearerTokenOf(c.req.header("authorization"));
  if (apiKey) {
    return {
      key: `key:${fingerprint(apiKey)}`,
      limit: config.rateLimitPerMinute,
    };
  }
  const session = sessionCookieOf(c.req.header("cookie"));
  if (session) {
    return {
      key: `session:${fingerprint(session)}`,
      limit: config.rateLimitPerMinute,
    };
  }
  const ip = clientIp(c);
  return ip ? { key: `ip:${ip}`, limit: config.rateLimitPerMinute } : null;
}

function bearerTokenOf(header: string | undefined): string | null {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function sessionCookieOf(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (name.endsWith("session_token")) {
      return part.slice(separator + 1).trim() || null;
    }
  }
  return null;
}

/** FNV-1a: keeps credentials out of the counter map's keys. */
function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36) + value.length.toString(36);
}

export class FixedWindowLimiter {
  private readonly windows = new Map<
    string,
    { start: number; count: number }
  >();

  hit(
    limitKey: LimitKey,
    now: number,
  ): { limited: false } | { limited: true; retryAfterSeconds: number } {
    if (!limitKey) return { limited: false };
    const current = this.windows.get(limitKey.key);
    if (!current || now - current.start >= WINDOW_MS) {
      this.sweep(now);
      this.windows.set(limitKey.key, { start: now, count: 1 });
      return { limited: false };
    }
    current.count += 1;
    if (current.count <= limitKey.limit) return { limited: false };
    return {
      limited: true,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((current.start + WINDOW_MS - now) / 1000),
      ),
    };
  }

  /** Drops the windows that ended, once the map grows (bounded memory). */
  private sweep(now: number) {
    if (this.windows.size < 10_000) return;
    for (const [key, window] of this.windows) {
      if (now - window.start >= WINDOW_MS) this.windows.delete(key);
    }
  }
}
