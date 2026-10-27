import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyBodyLimit } from "./body-limit";
import { applyOriginGuard } from "./origin-guard";
import { applyRateLimit, FixedWindowLimiter } from "./rate-limit";
import type { Env } from "./env";

const ENV = {
  NODE_ENV: "production",
  APP_URL: "https://app.example.com",
  PORTAL_APP_URL: "https://portal.example.com",
  API_URL: "https://app.example.com",
  REMOTE_ADDRESS: "203.0.113.9",
};

function appWith(apply: (app: Hono<{ Bindings: Env }>) => void) {
  const app = new Hono<{ Bindings: Env }>();
  apply(app);
  app.all("/api/*", async (c) => {
    if (c.req.method !== "GET") await c.req.text();
    return c.json({ ok: true });
  });
  return app;
}

function request(
  app: Hono<{ Bindings: Env }>,
  path: string,
  init: RequestInit & { headers?: Record<string, string> },
  env: Record<string, string> = ENV,
) {
  return app.request(path, init, env);
}

describe("origin guard (roadmap 2 D1)", () => {
  const app = appWith(applyOriginGuard);

  it("refuses a cookie-authenticated write from a foreign origin", async () => {
    const res = await request(app, "/api/jobs", {
      method: "POST",
      headers: {
        cookie: "calibra.session_token=abc",
        origin: "https://evil.example.net",
        host: "app.example.com",
      },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      code: "CROSS_SITE_REQUEST_BLOCKED",
    });
  });

  it("refuses a write from a custom portal domain that is not the request's own origin", async () => {
    const res = await request(app, "/api/portal/requests", {
      method: "POST",
      headers: {
        cookie: "calibra.session_token=abc",
        origin: "https://portal.lab-owned.example",
        host: "app.example.com",
      },
    });
    expect(res.status).toBe(403);
  });

  it("refuses an opaque (null) origin and a cross-site Fetch Metadata request without Origin", async () => {
    const nullOrigin = await request(app, "/api/jobs", {
      method: "DELETE",
      headers: { cookie: "s=1", origin: "null", host: "app.example.com" },
    });
    const crossSite = await request(app, "/api/jobs", {
      method: "PATCH",
      headers: { cookie: "s=1", "sec-fetch-site": "cross-site" },
    });
    expect(nullOrigin.status).toBe(403);
    expect(crossSite.status).toBe(403);
  });

  it("lets through the configured app origin, the request's own origin (a proxied custom domain) and same-origin Fetch Metadata", async () => {
    const configured = await request(app, "/api/jobs", {
      method: "POST",
      headers: {
        cookie: "s=1",
        origin: "https://portal.example.com",
        host: "app.example.com",
      },
    });
    const sameOrigin = await request(app, "/api/portal/requests", {
      method: "POST",
      headers: {
        cookie: "s=1",
        origin: "https://portal.lab-owned.example",
        host: "portal.lab-owned.example",
      },
    });
    const fetchMetadata = await request(app, "/api/jobs", {
      method: "POST",
      headers: { cookie: "s=1", "sec-fetch-site": "same-origin" },
    });
    expect([
      configured.status,
      sameOrigin.status,
      fetchMetadata.status,
    ]).toEqual([200, 200, 200]);
  });

  it("does not judge reads, cookie-less requests or header-authenticated calls", async () => {
    const foreign = {
      origin: "https://evil.example.net",
      host: "app.example.com",
    };
    const read = await request(app, "/api/jobs", {
      method: "GET",
      headers: { cookie: "s=1", ...foreign },
    });
    const noCookie = await request(app, "/api/verify/x/match", {
      method: "POST",
      headers: foreign,
    });
    const apiKey = await request(app, "/api/public/v2/jobs", {
      method: "POST",
      headers: { cookie: "s=1", "x-api-key": "ck_1", ...foreign },
    });
    expect([read.status, noCookie.status, apiKey.status]).toEqual([
      200, 200, 200,
    ]);
  });
});

describe("rate limit (roadmap 2 D1)", () => {
  beforeEach(() => {
    vi.stubEnv("API_RATE_LIMIT_PER_MINUTE", "3");
    vi.stubEnv("API_PUBLIC_RATE_LIMIT_PER_MINUTE", "2");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("answers 429 with Retry-After once a caller spends the window, per caller", async () => {
    const app = appWith(applyRateLimit);
    const statuses: number[] = [];
    for (let index = 0; index < 4; index += 1) {
      const res = await request(app, "/api/jobs", {
        method: "GET",
        headers: { cookie: "calibra.session_token=user-1" },
      });
      statuses.push(res.status);
      if (res.status === 429) {
        expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
        expect(await res.json()).toMatchObject({ code: "RATE_LIMITED" });
      }
    }
    expect(statuses).toEqual([200, 200, 200, 429]);

    const otherUser = await request(app, "/api/jobs", {
      method: "GET",
      headers: { cookie: "calibra.session_token=user-2" },
    });
    expect(otherUser.status).toBe(200);
  });

  it("holds the unauthenticated endpoints to their stricter limit, per client address", async () => {
    const app = appWith(applyRateLimit);
    const statuses: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      statuses.push(
        (await request(app, "/api/verify/token", { method: "GET" })).status,
      );
    }
    expect(statuses).toEqual([200, 200, 429]);
    const otherAddress = await request(
      app,
      "/api/verify/token",
      { method: "GET" },
      { ...ENV, REMOTE_ADDRESS: "203.0.113.10" },
    );
    expect(otherAddress.status).toBe(200);
  });

  it("a new window starts after a minute", () => {
    const limiter = new FixedWindowLimiter();
    const key = { key: "k", limit: 1 };
    expect(limiter.hit(key, 0)).toEqual({ limited: false });
    expect(limiter.hit(key, 1_000)).toEqual({
      limited: true,
      retryAfterSeconds: 59,
    });
    expect(limiter.hit(key, 60_000)).toEqual({ limited: false });
  });
});

describe("body limit (roadmap 2 D1)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("answers 413 above API_MAX_BODY_BYTES and lets a body under it through", async () => {
    vi.stubEnv("API_MAX_BODY_BYTES", "2048");
    const app = appWith(applyBodyLimit);
    const over = await request(app, "/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: "x".repeat(4096) }),
    });
    const under = await request(app, "/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: "x".repeat(100) }),
    });
    expect(over.status).toBe(413);
    expect(await over.json()).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(under.status).toBe(200);
  });
});
