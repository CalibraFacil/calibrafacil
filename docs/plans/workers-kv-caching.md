# Workers KV Caching Plan

## Why

Zero caching today. Every request hits Neon via Hyperdrive — including the dashboard (7 parallel DB queries) and heavy join-based listings. KV gives sub-millisecond reads at the edge, perfect for org-scoped data that changes infrequently.

## What to Cache (by priority)

| Priority | Endpoint | Cache Key Pattern | TTL | Reason |
|----------|----------|-------------------|-----|--------|
| **P0** | `GET /api/dashboard/stats` | `org:{orgId}:dashboard` | 60s | 7 DB queries per load |
| **P0** | `GET /api/methods` | `org:{orgId}:methods` | 300s | Rarely changes, read on every job form |
| **P0** | `GET /api/services` | `org:{orgId}:services` | 300s | Same — catalog data |
| **P1** | `GET /api/asset-types` | `org:{orgId}:asset-types` | 300s | Reference data |
| **P1** | `GET /api/standards` | `org:{orgId}:standards:{hash(filters)}` | 120s | Moderate read frequency |
| **P1** | `GET /api/customers` | `org:{orgId}:customers:{hash(filters)}` | 120s | Frequently listed |
| **P2** | `GET /api/jobs` | `org:{orgId}:jobs:{hash(filters)}` | 30s | Most dynamic, but heaviest query |
| **P2** | `GET /api/jobs/:id` | `org:{orgId}:job:{id}` | 60s | 5-table join |
| **P3** | `GET /api/portal/certificates` | `portal:{customerId}:certs:{hash(filters)}` | 120s | Portal reads |
| **P3** | `GET /api/verify/:code` | `verify:{code}` | 3600s | Public, immutable after approval |

## Implementation Steps

### 1. Add KV binding

`apps/api/wrangler.jsonc` — add KV namespace binding:

```jsonc
"kv_namespaces": [{ "binding": "CACHE", "id": "<production-id>" }]
```

Update `Env` interface in `apps/api/src/index.ts` to include `CACHE: KVNamespace`.

### 2. Create cache utility (`apps/api/src/lib/cache.ts`)

Three functions:

- `kvGet<T>(kv, key)` — typed read, returns `T | null`
- `kvPut(kv, key, value, ttl)` — write with expiration
- `kvInvalidate(kv, prefix)` — list-and-delete by prefix (for org-scoped bust)

Cache key builder: `buildCacheKey(orgId, resource, filters?)` — deterministic hash of filters via `JSON.stringify` + sorted keys.

### 3. Cache-aside middleware (`apps/api/src/middleware/cache.ts`)

Hono middleware that:

1. Builds key from `orgId` + route + query params
2. Checks KV — if hit, returns cached JSON with `X-Cache: HIT` header
3. If miss, calls `next()`, captures response, writes to KV, returns with `X-Cache: MISS`
4. Only caches `200` GET responses

Usage:

```typescript
.get("/", ...withLabPermission({ dashboard: ["read"] }), withCache("dashboard", 60), handler)
```

### 4. Cache invalidation

On mutations (POST/PUT/PATCH/DELETE), invalidate related cache keys. Two strategies combined:

- **Targeted**: After updating a job, delete `org:{orgId}:job:{id}` and `org:{orgId}:jobs:*` and `org:{orgId}:dashboard`
- **Middleware-based**: Create `invalidateCache(...resources)` middleware applied to mutation routes that auto-busts by resource prefix

Invalidation map:

| Mutation on | Invalidate |
|-------------|-----------|
| jobs | `jobs:*`, `dashboard`, `job:{id}` |
| customers | `customers:*`, `jobs:*` |
| assets | `assets:*`, `jobs:*` |
| standards | `standards:*`, `dashboard` |
| methods | `methods` |
| services | `services` |

### 5. Roll out incrementally

1. Start with P0 (dashboard, methods, services) — highest gain, lowest invalidation complexity
2. Add P1 after validating in production
3. Add P2/P3 with short TTLs

## Key Decisions

- **No `waitUntil` for writes**: KV writes are fast enough inline; avoids complexity
- **Hash filters, not full URL**: Query param order shouldn't matter
- **Short TTLs over complex invalidation**: 30-120s TTLs mean stale data is bounded. Invalidation is best-effort optimization on top
- **Skip caching authenticated user-specific data**: Only cache org-scoped data where all members see the same result
- **KV 25M free reads/month**: More than enough for current scale

## Not in Scope

- Response compression (KV stores raw JSON; Cloudflare handles gzip at edge)
- Cache warming on deploy
- Analytics/hit-rate tracking (add later if needed)
