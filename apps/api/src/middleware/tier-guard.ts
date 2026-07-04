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
import { eq, and, gte, count, sql } from "drizzle-orm";
import {
  ENTITLEMENT_METADATA,
  getPlan,
  getEffectivePlanLimits,
  hasFeature,
  isSubscriptionActive,
  isValidPlanId,
  type PlanId,
  type FeatureFlag,
  type PlanLimits,
  type SubscriptionStatus,
} from "@calibra-facil/shared";
import type { AuthVariables } from "./permission";
import { getOrganizationStorageBytes } from "../lib/storage-usage-db";

// =============================================================================
// TIER GUARD MIDDLEWARE
// =============================================================================

/**
 * Resource types that can be limited by plan
 */
export type LimitResource = keyof PlanLimits;

/**
 * Minimal DB surface needed to check a plan limit — satisfied by both the
 * shared `db` singleton (used by the fast pre-check) and a Drizzle
 * transaction (`tx`) handed in by a caller (used by the in-transaction,
 * lock-protected re-check).
 */
export type PlanLimitDbExecutor = Pick<typeof db, "execute" | "select">;

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
  const requestedCount = Math.max(0, requested);

  // Get subscription
  const sub = await getSubscription(memberData.organizationId);

  // Determine effective plan (FREE if no subscription)
  const planId = toPlanId(sub?.planId);
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

  const limit = getEffectivePlanLimits(planId, currentOrganization?.createdAt)[
    resource
  ];

  // Get current usage
  const usage = await getResourceUsage(memberData.organizationId, resource, db);
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
 * Re-check a plan limit INSIDE a caller-owned transaction, holding a
 * per-organization+resource Postgres advisory lock (`pg_advisory_xact_lock`,
 * automatically released at transaction end) for the duration of that
 * transaction.
 *
 * Why this exists: `assertPlanLimit` above (and the `requirePlanLimit`
 * middleware built on it) is a fast, UX fail-fast pre-check that runs BEFORE
 * any DB transaction is opened. Two requests racing at the quota boundary can
 * both pass that pre-check and then both proceed to insert past the limit —
 * a TOCTOU window. Call this function from inside `db.transaction`, passing
 * that transaction as `executor`, immediately before the row(s) that count
 * toward `resource` are inserted. The advisory lock serializes concurrent
 * callers for the same organization+resource, and the usage re-read happens
 * against the transaction (so it sees any not-yet-committed-but-locked-ahead
 * writes only after they commit and the lock is released), closing the race.
 *
 * This mirrors the pattern `calibration-requests.ts`'s `POST /:id/convert`
 * route has always used inline; `jobs.ts`'s `POST /` previously relied on the
 * pre-check alone (issue #659 / REQ-DOM-QTA-001).
 *
 * Throws the same `HTTPException` shapes as `assertPlanLimit` (402 for an
 * inactive subscription or an exceeded limit) so callers can handle it
 * identically to the pre-check.
 */
export async function assertPlanLimitInTransaction(
  executor: PlanLimitDbExecutor,
  params: {
    organizationId: string;
    resource: LimitResource;
    requested?: number;
  },
): Promise<void> {
  const { organizationId, resource } = params;
  const requestedCount = Math.max(0, params.requested ?? 1);

  // Serialize concurrent callers for this organization+resource. Held for the
  // remainder of the enclosing transaction (xact-scoped lock).
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`plan-limit:${resource}:${organizationId}`}))`,
  );

  const [activeSubscription] = await executor
    .select({ planId: subscription.planId, status: subscription.status })
    .from(subscription)
    .where(eq(subscription.organizationId, organizationId))
    .limit(1);

  const planId = toPlanId(activeSubscription?.planId);
  const status = toSubscriptionStatus(activeSubscription?.status);

  if (
    activeSubscription &&
    !isSubscriptionActive(status) &&
    status !== "PAST_DUE"
  ) {
    throw new HTTPException(402, {
      message: "Assinatura inativa. Ative um plano para continuar.",
      cause: { code: "SUBSCRIPTION_INACTIVE", planId, status },
    });
  }

  const [currentOrganization] = await executor
    .select({ createdAt: organization.createdAt })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  const limit = getEffectivePlanLimits(planId, currentOrganization?.createdAt)[
    resource
  ];

  const usage = await getResourceUsage(organizationId, resource, executor);
  const projectedUsage = usage + requestedCount;

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
    const sub = await getSubscription(memberData.organizationId);

    // Determine effective plan (FREE if no subscription)
    const planId = toPlanId(sub?.planId);
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
// SUBSCRIPTION LOOKUP
// =============================================================================

interface SubscriptionInfo {
  planId: PlanId;
  status: SubscriptionStatus;
}

/**
 * Get subscription data for an organization.
 */
async function getSubscription(
  organizationId: string,
): Promise<SubscriptionInfo | null> {
  const sub = await db.query.subscription.findFirst({
    where: eq(subscription.organizationId, organizationId),
  });

  if (!sub) return null;

  return {
    planId: toPlanId(sub.planId),
    status: toSubscriptionStatus(sub.status),
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get current usage for a specific resource.
 *
 * `executor` defaults to the shared `db` singleton (used by the
 * non-transactional pre-check) but accepts a Drizzle transaction so the
 * in-transaction re-check (`assertPlanLimitInTransaction`) sees the correct,
 * lock-consistent count.
 */
async function getResourceUsage(
  organizationId: string,
  resource: LimitResource,
  executor: PlanLimitDbExecutor = db,
): Promise<number> {
  switch (resource) {
    case "certificates":
      return getCertificateUsage(organizationId, executor);
    case "users":
      return getUserUsage(organizationId, executor);
    case "storage":
      return getStorageUsage(organizationId, executor);
    default:
      return 0;
  }
}

/**
 * Get certificate usage (jobs created this month)
 */
async function getCertificateUsage(
  organizationId: string,
  executor: PlanLimitDbExecutor = db,
): Promise<number> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [result] = await executor
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
async function getUserUsage(
  organizationId: string,
  executor: PlanLimitDbExecutor = db,
): Promise<number> {
  const [result] = await executor
    .select({ count: count() })
    .from(member)
    .where(eq(member.organizationId, organizationId));

  return result?.count ?? 0;
}

/**
 * Get storage usage (total bytes of size-tracked R2 objects for the org).
 * See `lib/storage-usage-db.ts` for the sources counted and the known limitation
 * (generated PDFs/XLSX are not yet size-tracked).
 */
async function getStorageUsage(
  organizationId: string,
  // Storage metering reads live in lib/storage-usage-db (no executor variant);
  // the param keeps the resource-dispatch signature uniform for the
  // in-transaction re-check path (certificates is the advisory-locked one).
  _executor: PlanLimitDbExecutor = db,
): Promise<number> {
  return getOrganizationStorageBytes(organizationId);
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
  return [requirePlanLimit(resource)];
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
  return [requireFeature(feature)];
}

function toPlanId(value: unknown): PlanId {
  return typeof value === "string" && isValidPlanId(value) ? value : "FREE";
}

function toSubscriptionStatus(value: unknown): SubscriptionStatus {
  switch (value) {
    case "ACTIVE":
    case "PAST_DUE":
    case "CANCELED":
    case "TRIAL":
      return value;
    default:
      return "TRIAL";
  }
}
