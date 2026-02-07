/**
 * Workers KV Cache Utilities
 *
 * Provides typed get/put/invalidation helpers for Cloudflare Workers KV.
 * All cache keys are prefixed to avoid collisions and enable prefix-based invalidation.
 */

// =============================================================================
// TYPES
// =============================================================================

export interface CacheOptions {
  /** Time-to-live in seconds */
  ttl: number;
}

// =============================================================================
// CORE OPERATIONS
// =============================================================================

/**
 * Read a typed value from KV cache.
 * Returns null on miss or if KV is unavailable (graceful degradation).
 */
export async function kvGet<T>(kv: KVNamespace | undefined, key: string): Promise<T | null> {
  if (!kv) return null;
  try {
    const raw = await kv.get(key, "text");
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch {
    // KV failure should never break the request
    return null;
  }
}

/**
 * Write a value to KV cache with TTL-based expiration.
 */
export async function kvPut(
  kv: KVNamespace | undefined,
  key: string,
  value: unknown,
  opts: CacheOptions,
): Promise<void> {
  if (!kv) return;
  try {
    await kv.put(key, JSON.stringify(value), {
      expirationTtl: opts.ttl,
    });
  } catch {
    // Best-effort write — don't let cache failures propagate
  }
}

/**
 * Delete a single key from KV cache.
 */
export async function kvDelete(kv: KVNamespace | undefined, key: string): Promise<void> {
  if (!kv) return;
  try {
    await kv.delete(key);
  } catch {
    // Best-effort delete
  }
}

/**
 * Invalidate all keys matching a prefix.
 * Uses KV list + delete. Limited to 1000 keys per call (KV list limit).
 * For our use case (org-scoped keys), this is more than sufficient.
 */
export async function kvInvalidateByPrefix(
  kv: KVNamespace | undefined,
  prefix: string,
): Promise<void> {
  if (!kv) return;
  try {
    const list = await kv.list({ prefix });
    if (list.keys.length === 0) return;
    await Promise.all(list.keys.map((k) => kv.delete(k.name)));
  } catch {
    // Best-effort invalidation
  }
}

// =============================================================================
// CACHE KEY BUILDERS
// =============================================================================

/**
 * Build a deterministic cache key from org ID, resource name, and optional filters.
 * Filters are sorted by key to ensure consistent hashing regardless of param order.
 */
export function buildCacheKey(
  orgId: string,
  resource: string,
  filters?: Record<string, unknown>,
): string {
  const base = `org:${orgId}:${resource}`;
  if (!filters || Object.keys(filters).length === 0) return base;

  // Sort keys and build a stable suffix
  const sorted = Object.keys(filters)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      const val = filters[key];
      // Skip undefined/null/empty values
      if (val !== undefined && val !== null && val !== "") {
        acc[key] = val;
      }
      return acc;
    }, {});

  if (Object.keys(sorted).length === 0) return base;

  return `${base}:${JSON.stringify(sorted)}`;
}

/**
 * Build a subscription cache key for the tier guard.
 */
export function subscriptionCacheKey(orgId: string): string {
  return `org:${orgId}:subscription`;
}

/**
 * Build a usage cache key for tier guard resource checks.
 */
export function usageCacheKey(orgId: string, resource: string): string {
  return `org:${orgId}:usage:${resource}`;
}

/**
 * Build a dashboard stats cache key.
 */
export function dashboardCacheKey(orgId: string): string {
  return `org:${orgId}:dashboard`;
}

// =============================================================================
// INVALIDATION HELPERS
// =============================================================================

/**
 * Invalidate all cache entries for an organization by resource type.
 * Accepts an array of resource names to invalidate.
 */
export async function invalidateOrgCache(
  kv: KVNamespace | undefined,
  orgId: string,
  resources: string[],
): Promise<void> {
  if (!kv) return;
  await Promise.all(
    resources.map((resource) => kvInvalidateByPrefix(kv, `org:${orgId}:${resource}`)),
  );
}

/**
 * Mapping of resource mutations to cache keys that should be invalidated.
 * When a resource is mutated, these related caches become stale.
 */
export const INVALIDATION_MAP: Record<string, string[]> = {
  jobs: ["jobs", "dashboard", "usage:certificates"],
  customers: ["customers"],
  assets: ["assets"],
  standards: ["standards", "dashboard"],
  methods: ["methods"],
  services: ["services"],
  "asset-types": ["asset-types"],
  members: ["usage:users"],
  subscription: ["subscription"],
};

/**
 * Invalidate caches based on what resource was mutated.
 * Uses the INVALIDATION_MAP to determine which caches to bust.
 */
export async function invalidateOnMutation(
  kv: KVNamespace | undefined,
  orgId: string,
  mutatedResource: string,
): Promise<void> {
  const targets = INVALIDATION_MAP[mutatedResource];
  if (!targets) return;
  await invalidateOrgCache(kv, orgId, targets);
}

// =============================================================================
// TTL CONSTANTS
// =============================================================================

/** TTL values in seconds for different cache types */
export const CACHE_TTL = {
  /** Subscription data — short TTL, critical for limit enforcement */
  subscription: 60,
  /** Resource usage counters */
  usage: 60,
  /** Dashboard stats — can tolerate some staleness */
  dashboard: 120,
  /** Reference data (methods, services) — rarely changes */
  referenceData: 300,
  /** Asset types — global data, very stable */
  assetTypes: 300,
  /** Public certificate verification — immutable after approval */
  verify: 3600,
} as const;
