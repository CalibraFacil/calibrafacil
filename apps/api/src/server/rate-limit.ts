import { readRuntimeConfig } from "@calibra-facil/config";
import type { Context, Hono } from "hono";
import { clientIp } from "../lib/client-ip";
import type { Env } from "./env";

/**
 * Request rate limits: one fixed one-minute window per
 * caller, answered 429 with `Retry-After` once spent.
 *
 * The caller is the client address (lib/client-ip.ts) until the request has
 * proved a credential: an API key or session cookie gets a counter of its own
 * only once an earlier request carrying it was accepted by the authentication
 * middleware (`VerifiedCredentials`). A credential the limiter merely finds in a
 * header or cookie is attacker-chosen text: keying on it would let a caller who
 * sends a different fake value each time escape every counter. The
 * unauthenticated endpoints (certificate verification, magic links, the
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
  const verified = new VerifiedCredentials();
  app.use("/api/*", async (c, next) => {
    const credential = credentialOf(c);
    const proven =
      credential && verified.has(credential.id, Date.now()) ? credential : null;
    const decision = limiter.hit(limitKeyOf(c, proven), Date.now());
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
    if (credential && wasAuthenticatedBy(c, credential.kind)) {
      verified.add(credential.id, Date.now());
    }
  });
}

const WINDOW_MS = 60_000;

/** The endpoints a visitor reaches without signing in. */
const PUBLIC_PREFIXES = [
  "/api/verify",
  "/api/magic-link",
  "/api/public/oot-ack",
  "/api/public/service-order-access",
];

type LimitKey = { key: string; limit: number } | null;

function limitKeyOf(
  c: Context<{ Bindings: Env }>,
  proven: Credential | null,
): LimitKey {
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

  if (proven) return { key: proven.id, limit: config.rateLimitPerMinute };
  const ip = clientIp(c);
  return ip ? { key: `ip:${ip}`, limit: config.rateLimitPerMinute } : null;
}

type Credential = { kind: "key" | "session"; id: string };

/** The credential a request presents (not yet believed): its API key, else its session cookie. */
function credentialOf(c: Context<{ Bindings: Env }>): Credential | null {
  const apiKey =
    c.req.header("x-api-key") ?? bearerTokenOf(c.req.header("authorization"));
  if (apiKey) return { kind: "key", id: `key:${fingerprint(apiKey)}` };
  const session = sessionCookieOf(c.req.header("cookie"));
  if (session) {
    return { kind: "session", id: `session:${fingerprint(session)}` };
  }
  return null;
}

/**
 * Whether the authentication middleware accepted the request, by the same kind
 * of credential the limiter read: a request authenticated by its session says
 * nothing about a fake API key it also carried.
 */
function wasAuthenticatedBy(
  c: Context<{ Bindings: Env }>,
  kind: Credential["kind"],
): boolean {
  const variables = c.var;
  if (kind === "key") return Reflect.get(variables, "apiKey") != null;
  return (
    Reflect.get(variables, "apiKey") == null &&
    Reflect.get(variables, "session") != null
  );
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

const VERIFIED_TTL_MS = 5 * 60_000;
const VERIFIED_MAX = 10_000;

/**
 * Fingerprints of credentials the authentication middleware accepted, for a few
 * minutes. Bounded: the oldest entry goes first once the map is full, so a flood
 * of valid credentials cannot grow it either.
 */
export class VerifiedCredentials {
  private readonly expiry = new Map<string, number>();

  has(id: string, now: number): boolean {
    const expiresAt = this.expiry.get(id);
    if (expiresAt === undefined) return false;
    if (expiresAt <= now) {
      this.expiry.delete(id);
      return false;
    }
    return true;
  }

  add(id: string, now: number) {
    this.expiry.delete(id);
    this.expiry.set(id, now + VERIFIED_TTL_MS);
    if (this.expiry.size > VERIFIED_MAX) {
      const oldest = this.expiry.keys().next();
      if (!oldest.done) this.expiry.delete(oldest.value);
    }
  }
}
