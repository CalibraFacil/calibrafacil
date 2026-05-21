import { createMiddleware } from "hono/factory";
import {
  kvGet,
  kvPut,
  buildCacheKey,
  invalidateOnMutation,
} from "../lib/cache";
import type { AuthVariables } from "./permission";

// =============================================================================
// CACHE-ASIDE MIDDLEWARE (for GET responses)
// =============================================================================

/**
 * Cache-aside middleware for GET endpoints.
 * Checks KV for a cached response before hitting the handler.
 * On cache miss, captures the response and stores it in KV.
 *
 * Only caches 200 JSON responses. Sets X-Cache header (HIT/MISS).
 *
 * @param resource - Resource name for cache key (e.g., "dashboard", "methods")
 * @param ttl - Time-to-live in seconds
 *
 * @example
 * .get("/stats", ...withLabPermission({ calibration: ["read"] }), withCache("dashboard", 120), handler)
 */
export function withCache(resource: string, ttl: number) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    // Only cache GET requests
    if (c.req.method !== "GET") {
      await next();
      return;
    }

    const kv = getCacheNamespace(c.env);
    if (!kv) {
      await next();
      return;
    }

    const member = c.get("member");
    const orgId = member.organizationId;

    // Build deterministic cache key from query params
    const url = new URL(c.req.url);
    const filters: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      filters[key] = value;
    });
    filters.__unitScope =
      member.selectedUnitScope === "all"
        ? "all"
        : member.activeUnitId !== null
          ? `unit:${member.activeUnitId}`
          : "none";

    const cacheKey = buildCacheKey(orgId, resource, filters);

    // Check cache
    const cached = await kvGet<{ body: unknown; status: number }>(kv, cacheKey);
    if (cached) {
      c.header("X-Cache", "HIT");
      return c.json(toJsonResponseBody(cached.body), 200);
    }

    // Cache miss — run the handler
    await next();

    // Only cache successful JSON responses
    if (c.res.status === 200) {
      const contentType = c.res.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        try {
          // Clone the response to read its body without consuming it
          const body = await c.res.clone().json();
          // Fire-and-forget write to KV
          kvPut(kv, cacheKey, { body, status: 200 }, { ttl });
        } catch {
          // If we can't read the response, skip caching
        }
      }
    }

    c.header("X-Cache", "MISS");
  });
}

// =============================================================================
// CACHE INVALIDATION MIDDLEWARE (for mutations)
// =============================================================================

/**
 * Middleware that invalidates cache entries after a successful mutation.
 * Apply to POST/PUT/PATCH/DELETE routes.
 *
 * @param resource - The resource being mutated (must match INVALIDATION_MAP keys)
 *
 * @example
 * .post("/", ...withLabPermission({ calibration: ["create"] }), withInvalidation("jobs"), handler)
 */
export function withInvalidation(resource: string) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    await next();

    // Only invalidate on successful mutations
    if (c.res.status >= 200 && c.res.status < 300) {
      const kv = getCacheNamespace(c.env);
      const member = c.get("member");
      if (kv && member) {
        // Fire-and-forget — don't block the response
        invalidateOnMutation(kv, member.organizationId, resource);
      }
    }
  });
}

function getCacheNamespace(env: unknown): KVNamespace | undefined {
  const cache = readProperty(env, "CACHE");
  return isKvNamespace(cache) ? cache : undefined;
}

function isKvNamespace(value: unknown): value is KVNamespace {
  return (
    typeof readProperty(value, "get") === "function" &&
    typeof readProperty(value, "put") === "function" &&
    typeof readProperty(value, "delete") === "function"
  );
}

function readProperty(value: unknown, key: string): unknown {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return undefined;
  }

  return Reflect.get(value, key);
}

function toJsonResponseBody(value: unknown): object {
  return value !== null && typeof value === "object" ? value : { data: value };
}
