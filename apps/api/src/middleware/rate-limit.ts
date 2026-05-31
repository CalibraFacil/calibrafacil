import { createMiddleware } from "hono/factory";

type RateLimitOptions = {
  keyPrefix: string;
  limit: number;
  windowSec: number;
  skip?: (request: { method: string; path: string }) => boolean;
};

function getClientIp(headers: Headers): string {
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    "unknown"
  );
}

function getWindowState(windowSec: number) {
  const nowMs = Date.now();
  const windowMs = windowSec * 1000;
  const currentWindow = Math.floor(nowMs / windowMs);
  const resetAtMs = (currentWindow + 1) * windowMs;
  const retryAfterSec = Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000));

  return {
    nowMs,
    windowMs,
    currentWindow,
    resetAtMs,
    retryAfterSec,
  };
}

export function withRateLimit(options: RateLimitOptions) {
  return createMiddleware<{ Bindings: { CACHE?: KVNamespace } }>(
    async (c, next) => {
      if (
        c.req.method === "OPTIONS" ||
        options.skip?.({ method: c.req.method, path: c.req.path })
      ) {
        await next();
        return;
      }

      const kv = c.env.CACHE;
      if (!kv) {
        await next();
        return;
      }

      const ip = getClientIp(c.req.raw.headers);
      const state = getWindowState(options.windowSec);
      const key = `rl:${options.keyPrefix}:${ip}:${state.currentWindow}`;

      let current = 0;
      try {
        const raw = await kv.get(key, "text");
        current = raw ? Number.parseInt(raw, 10) || 0 : 0;
      } catch {
        current = 0;
      }

      if (current >= options.limit) {
        c.header("Retry-After", String(state.retryAfterSec));
        c.header("X-RateLimit-Limit", String(options.limit));
        c.header("X-RateLimit-Remaining", "0");
        c.header(
          "X-RateLimit-Reset",
          String(Math.floor(state.resetAtMs / 1000)),
        );
        return c.json({ error: "Too many requests" }, 429);
      }

      const nextCount = current + 1;
      const remaining = Math.max(0, options.limit - nextCount);

      try {
        await kv.put(key, String(nextCount), {
          expirationTtl: options.windowSec + 5,
        });
      } catch {
        // Best effort only.
      }

      c.header("X-RateLimit-Limit", String(options.limit));
      c.header("X-RateLimit-Remaining", String(remaining));
      c.header("X-RateLimit-Reset", String(Math.floor(state.resetAtMs / 1000)));

      await next();
    },
  );
}

export function isBetterAuthSessionLookupPath(path: string) {
  return /^\/api\/auth\/(?:lab|backoffice|portal)\/get-session\/?$/.test(path);
}

export const rateLimitAuth = withRateLimit({
  keyPrefix: "auth",
  limit: 30,
  windowSec: 60,
  skip: ({ path }) => isBetterAuthSessionLookupPath(path),
});

export const rateLimitInvitations = withRateLimit({
  keyPrefix: "invitations",
  limit: 60,
  windowSec: 60,
});

export const rateLimitVerify = withRateLimit({
  keyPrefix: "verify",
  limit: 120,
  windowSec: 60,
});

export const rateLimitWebhooks = withRateLimit({
  keyPrefix: "webhooks",
  limit: 300,
  windowSec: 60,
});

export const rateLimitPublicApi = withRateLimit({
  keyPrefix: "public-api",
  limit: 180,
  windowSec: 60,
});
