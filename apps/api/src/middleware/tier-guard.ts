import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { db } from "@calibra-facil/db";
import {
  subscription,
  calibrationJob,
  member,
} from "@calibra-facil/db/schema";
import { eq, and, gte, count } from "drizzle-orm";
import {
  getPlan,
  getLimit,
  hasFeature,
  isSubscriptionActive,
  type PlanId,
  type FeatureFlag,
  type PlanLimits,
} from "@calibra-facil/shared";
import type { AuthVariables } from "./permission";

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
export function requirePlanLimit(resource: LimitResource) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const memberData = c.get("member");

    // Get subscription
    const sub = await db.query.subscription.findFirst({
      where: eq(subscription.organizationId, memberData.organizationId),
    });

    // Determine effective plan (FREE if no subscription)
    const planId: PlanId = sub?.planId as PlanId || "FREE";
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
      c.header("X-Subscription-Message", "Pagamento pendente. Regularize para evitar bloqueio.");
    }

    // Get plan limits
    const limit = getLimit(planId, resource);

    // Get current usage
    const usage = await getResourceUsage(memberData.organizationId, resource);

    // Check if limit exceeded
    if (usage >= limit) {
      const plan = getPlan(planId);
      throw new HTTPException(402, {
        message: `Limite de ${getResourceLabel(resource)} atingido (${usage}/${limit}). Faca upgrade para o proximo plano.`,
        cause: {
          code: "LIMIT_EXCEEDED",
          resource,
          current: usage,
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

    // Get subscription
    const sub = await db.query.subscription.findFirst({
      where: eq(subscription.organizationId, memberData.organizationId),
    });

    // Determine effective plan (FREE if no subscription)
    const planId: PlanId = sub?.planId as PlanId || "FREE";
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
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get current usage for a specific resource
 */
async function getResourceUsage(
  organizationId: string,
  resource: LimitResource
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
 * Get certificate usage (approved jobs this month)
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
        eq(calibrationJob.status, "APPROVED"),
        gte(calibrationJob.approvedAt, startOfMonth)
      )
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
  switch (feature) {
    case "math_engine":
      return "Calculo avancado de incerteza";
    case "portal":
      return "Portal do cliente";
    case "financial":
      return "Modulo financeiro";
    case "api":
      return "Acesso via API";
    case "custom_domain":
      return "Dominio personalizado";
    default:
      return feature;
  }
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
