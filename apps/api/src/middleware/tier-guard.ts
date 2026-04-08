import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { db } from "@calibra-facil/db";
import {
  subscription,
  calibrationJob,
  member,
  organization,
} from "@calibra-facil/db/schema";
import { eq, and, gte, count } from "drizzle-orm";
import {
  ENTITLEMENT_METADATA,
  getPlan,
  getEffectivePlanLimits,
  hasFeature,
  isSubscriptionActive,
  type PlanId,
  type FeatureFlag,
  type PlanLimits,
  type SubscriptionStatus,
} from "@calibra-facil/shared";
import type { AuthVariables } from "./permission";
import {
  kvGet,
  kvPut,
  subscriptionCacheKey,
  usageCacheKey,
  CACHE_TTL,
} from "../lib/cache";

// =============================================================================
// TIER GUARD MIDDLEWARE
// =============================================================================

/**
 * Resource types that can be limited by plan
 */
export type LimitResource = keyof PlanLimits;

/**
 * Middleware to check plan limits before allowing resource creation.
 * Uses soft blocking: warns on PAST_DUE but still allows access.
 *
 * @example
 * // In jobs.ts - check certificate limit before creating job
 * .post("/", ...withLabPermission({ calibration: ["create"] }), requirePlanLimit("certificates"), handler)
 *
 * // In invitations.ts - check user limit before inviting
 * .post("/", ...withLabPermission({ member: ["create"] }), requirePlanLimit("users"), handler)
 */
export async function assertPlanLimit(
  c: Context<{ Variables: AuthVariables }>,
  resource: LimitResource,
  requested = 1,
) {
  const memberData = c.get("member");
  const kv = (c.env as Record<string, unknown>).CACHE as
    | KVNamespace
    | undefined;
  const requestedCount = Math.max(0, requested);

  // Get subscription (cached)
  const sub = await getCachedSubscription(kv, memberData.organizationId);

  // Determine effective plan (FREE if no subscription)
  const planId: PlanId = (sub?.planId as PlanId) || "FREE";
  const status = sub?.status || "TRIAL";

  // Check if subscription allows access
  if (sub && !isSubscriptionActive(status) && status !== "PAST_DUE") {
    throw new HTTPException(402, {
      message: "Assinatura inativa. Ative um plano para continuar.",
      cause: { code: "SUBSCRIPTION_INACTIVE", planId, status },
    });
  }

  // Warn but allow for PAST_DUE (soft block)
  if (status === "PAST_DUE") {
    c.header("X-Subscription-Warning", "past_due");
    c.header(
      "X-Subscription-Message",
      "Pagamento pendente. Regularize para evitar bloqueio.",
    );
  }

  // Get plan limits
  const currentOrganization = await db.query.organization.findFirst({
    columns: { createdAt: true },
    where: eq(organization.id, memberData.organizationId),
  });

  const limit = getEffectivePlanLimits(
    planId,
    currentOrganization?.createdAt,
  )[resource];

  // Get current usage (cached)
  const usage = await getCachedResourceUsage(
    kv,
    memberData.organizationId,
    resource,
  );
  const projectedUsage = usage + requestedCount;

  // Check if limit exceeded
  if (projectedUsage > limit) {
    const plan = getPlan(planId);
    const message =
      requestedCount > 1
        ? `Limite de ${getResourceLabel(resource)} seria excedido (${projectedUsage}/${limit}) nesta operacao. Faca upgrade para o proximo plano.`
        : `Limite de ${getResourceLabel(resource)} atingido (${usage}/${limit}). Faca upgrade para o proximo plano.`;

    throw new HTTPException(402, {
      message,
      cause: {
        code: "LIMIT_EXCEEDED",
        resource,
        current: usage,
        requested: requestedCount,
        projected: projectedUsage,
        limit,
        planId,
        planName: plan.name,
      },
    });
  }

  // Add usage info to response headers (for UI display)
  c.header("X-Plan-Id", planId);
  c.header(`X-Usage-${resource}`, String(usage));
  c.header(`X-Limit-${resource}`, String(limit));
}

export function requirePlanLimit(resource: LimitResource) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    await assertPlanLimit(c, resource);
    await next();
  });
}

/**
 * Middleware to check feature flags before allowing access.
 *
 * @example
 * // In portal.ts - require portal feature
 * .get("/", ...withLabPermission({ portal: ["read"] }), requireFeature("portal"), handler)
 *
 * // In math routes - require math_engine feature
 * .post("/calculate", requireFeature("math_engine"), handler)
 */
export function requireFeature(feature: FeatureFlag) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const memberData = c.get("member");
    const kv = (c.env as Record<string, unknown>).CACHE as
      | KVNamespace
      | undefined;

    // Get subscription (cached)
    const sub = await getCachedSubscription(kv, memberData.organizationId);

    // Determine effective plan (FREE if no subscription)
    const planId: PlanId = (sub?.planId as PlanId) || "FREE";
    const status = sub?.status || "TRIAL";

    // Check if subscription allows access
    if (sub && !isSubscriptionActive(status) && status !== "PAST_DUE") {
      throw new HTTPException(402, {
        message: "Assinatura inativa. Ative um plano para continuar.",
        cause: { code: "SUBSCRIPTION_INACTIVE", planId, status },
      });
    }

    // Check if plan has the required feature
    if (!hasFeature(planId, feature)) {
      const plan = getPlan(planId);
      throw new HTTPException(403, {
        message: `Recurso "${getFeatureLabel(feature)}" nao disponivel no plano ${plan.name}. Faca upgrade para acessar.`,
        cause: {
          code: "FEATURE_NOT_AVAILABLE",
          feature,
          planId,
          planName: plan.name,
        },
      });
    }

    // Add feature info to response headers
    c.header("X-Plan-Id", planId);
    c.header(`X-Feature-${feature}`, "enabled");

    await next();
  });
}

// =============================================================================
// CACHED LOOKUPS
// =============================================================================

interface CachedSubscription {
  planId: string;
  status: SubscriptionStatus;
}

/**
 * Get subscription data with KV caching.
 * Falls back to DB on cache miss or KV unavailability.
 */
async function getCachedSubscription(
  kv: KVNamespace | undefined,
  organizationId: string,
): Promise<CachedSubscription | null> {
  const cacheKey = subscriptionCacheKey(organizationId);

  // Try cache first
  const cached = await kvGet<CachedSubscription>(kv, cacheKey);
  if (cached !== null) return cached;

  // Cache miss — query DB
  const sub = await db.query.subscription.findFirst({
    where: eq(subscription.organizationId, organizationId),
  });

  if (!sub) {
    // Cache the "no subscription" state too (avoids repeated DB misses)
    await kvPut(kv, cacheKey, null, { ttl: CACHE_TTL.subscription });
    return null;
  }

  const result: CachedSubscription = {
    planId: sub.planId,
    status: sub.status as SubscriptionStatus,
  };

  await kvPut(kv, cacheKey, result, { ttl: CACHE_TTL.subscription });
  return result;
}

/**
 * Get resource usage with KV caching.
 * Falls back to DB on cache miss.
 */
async function getCachedResourceUsage(
  kv: KVNamespace | undefined,
  organizationId: string,
  resource: LimitResource,
): Promise<number> {
  const cacheKey = usageCacheKey(organizationId, resource);

  // Try cache first
  const cached = await kvGet<number>(kv, cacheKey);
  if (cached !== null) return cached;

  // Cache miss — query DB
  const usage = await getResourceUsage(organizationId, resource);

  await kvPut(kv, cacheKey, usage, { ttl: CACHE_TTL.usage });
  return usage;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get current usage for a specific resource
 */
async function getResourceUsage(
  organizationId: string,
  resource: LimitResource,
): Promise<number> {
  switch (resource) {
    case "certificates":
      return getCertificateUsage(organizationId);
    case "users":
      return getUserUsage(organizationId);
    case "storage":
      return getStorageUsage(organizationId);
    default:
      return 0;
  }
}

/**
 * Get certificate usage (jobs created this month)
 */
async function getCertificateUsage(organizationId: string): Promise<number> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [result] = await db
    .select({ count: count() })
    .from(calibrationJob)
    .where(
      and(
        eq(calibrationJob.organizationId, organizationId),
        gte(calibrationJob.createdAt, startOfMonth),
      ),
    );

  return result?.count ?? 0;
}

/**
 * Get user usage (member count)
 */
async function getUserUsage(organizationId: string): Promise<number> {
  const [result] = await db
    .select({ count: count() })
    .from(member)
    .where(eq(member.organizationId, organizationId));

  return result?.count ?? 0;
}

/**
 * Get storage usage (placeholder - implement when file storage tracking is added)
 */
async function getStorageUsage(_organizationId: string): Promise<number> {
  // TODO: Implement storage tracking
  return 0;
}

/**
 * Get human-readable label for resource
 */
function getResourceLabel(resource: LimitResource): string {
  switch (resource) {
    case "certificates":
      return "certificados por mes";
    case "users":
      return "usuarios";
    case "storage":
      return "armazenamento";
    default:
      return resource;
  }
}

/**
 * Get human-readable label for feature
 */
function getFeatureLabel(feature: FeatureFlag): string {
  return ENTITLEMENT_METADATA[feature]?.name ?? feature;
}

// =============================================================================
// COMBINED MIDDLEWARE HELPERS
// =============================================================================

/**
 * Create middleware chain with plan limit check
 *
 * @example
 * import { withPlanLimit } from "../middleware/tier-guard";
 * import { withLabPermission } from "../middleware/permission";
 *
 * .post("/", ...withLabPermission({ calibration: ["create"] }), ...withPlanLimit("certificates"), handler)
 */
export function withPlanLimit(resource: LimitResource) {
  return [requirePlanLimit(resource)] as const;
}

/**
 * Create middleware chain with feature check
 *
 * @example
 * import { withFeature } from "../middleware/tier-guard";
 *
 * .get("/", ...withLabPermission({ portal: ["read"] }), ...withFeature("portal"), handler)
 */
export function withFeature(feature: FeatureFlag) {
  return [requireFeature(feature)] as const;
}
