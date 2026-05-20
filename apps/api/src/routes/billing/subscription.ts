import { Hono } from "hono";
import { db } from "@calibra-facil/db";
import {
  subscription,
  calibrationJob,
  member,
  organization,
} from "@calibra-facil/db/schema";
import { eq, and, gte, count } from "drizzle-orm";
import {
  withLabPermission,
  type AuthVariables,
} from "../../middleware/permission";
import {
  getEffectivePlanLimits,
  getPlan,
  type PlanId,
} from "@calibra-facil/shared";
import { withInvalidation } from "../../middleware/cache";

// =============================================================================
// SUBSCRIPTION ROUTES - Organization subscription management
// =============================================================================

function serializePublicSubscription(
  sub: typeof subscription.$inferSelect | null,
) {
  if (!sub) {
    return null;
  }

  return {
    id: sub.id,
    planId: sub.planId,
    status: sub.status,
    billingCycle: sub.billingCycle,
    currentPeriodStart: sub.currentPeriodStart,
    currentPeriodEnd: sub.currentPeriodEnd,
    nextBillingDate: sub.nextBillingDate,
    canceledAt: sub.canceledAt,
    createdAt: sub.createdAt,
  };
}

export const subscriptionRouter = new Hono<{ Variables: AuthVariables }>()
  // =========================================================================
  // GET / - Get current organization's subscription
  // =========================================================================
  .get("/", ...withLabPermission({ billing: ["read"] }), async (c) => {
    const memberData = c.get("member");
    const currentOrganization = await db.query.organization.findFirst({
      columns: { createdAt: true },
      where: eq(organization.id, memberData.organizationId),
    });

    // Get subscription
    const sub = await db.query.subscription.findFirst({
      where: eq(subscription.organizationId, memberData.organizationId),
    });

    if (!sub) {
      // Return default FREE plan info for organizations without subscription
      const freePlan = getPlan("FREE");
      const usage = await getOrganizationUsage(memberData.organizationId);

      return c.json({
        subscription: null,
        plan: freePlan,
        usage,
        limits: getEffectivePlanLimits("FREE", currentOrganization?.createdAt),
      });
    }

    // Get plan details
    const plan = getPlan(sub.planId as PlanId);
    const usage = await getOrganizationUsage(memberData.organizationId);

    return c.json({
      subscription: serializePublicSubscription(sub),
      plan,
      usage,
      limits: getEffectivePlanLimits(plan.id, currentOrganization?.createdAt),
    });
  })

  // =========================================================================
  // DELETE / - Cancel subscription
  // =========================================================================
  .delete(
    "/",
    ...withLabPermission({ billing: ["update"] }),
    withInvalidation("subscription"),
    async (c) => {
      const memberData = c.get("member");

      const sub = await db.query.subscription.findFirst({
        where: eq(subscription.organizationId, memberData.organizationId),
      });

      if (!sub) {
        return c.json({ error: "Nenhuma assinatura encontrada" }, 404);
      }

      if (sub.status === "CANCELED") {
        return c.json({ error: "Assinatura ja esta cancelada" }, 400);
      }

      // Cancel in Asaas if exists
      if (sub.providerSubscriptionId) {
        try {
          const { cancelSubscription } = await import("../../services/asaas");
          await cancelSubscription(sub.providerSubscriptionId);
        } catch (error) {
          console.error("Error canceling Asaas subscription:", error);
          return c.json(
            {
              error:
                "Falha ao cancelar assinatura no provedor de pagamento. Tente novamente.",
            },
            502,
          );
        }

        try {
          const [updated] = await db
            .update(subscription)
            .set({
              status: "CANCELED",
              canceledAt: new Date(),
            })
            .where(eq(subscription.id, sub.id))
            .returning();

          return c.json({
            subscription: serializePublicSubscription(updated ?? null),
          });
        } catch (error) {
          console.error("Error updating canceled subscription locally:", {
            error,
            subscriptionId: sub.id,
            providerSubscriptionId: sub.providerSubscriptionId,
          });
          return c.json(
            {
              error:
                "Assinatura cancelada no provedor, mas falhou ao atualizar o estado local. Contate o suporte.",
            },
            500,
          );
        }
      }

      // Update local subscription
      const [updated] = await db
        .update(subscription)
        .set({
          status: "CANCELED",
          canceledAt: new Date(),
        })
        .where(eq(subscription.id, sub.id))
        .returning();

      return c.json({
        subscription: serializePublicSubscription(updated ?? null),
      });
    },
  );

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get organization usage metrics for tier guard
 */
export async function getOrganizationUsage(organizationId: string) {
  // Get start of current month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  // Count quota usage this month using the same created-at metric
  // enforced by tier guard quota checks.
  const [certResult] = await db
    .select({ count: count() })
    .from(calibrationJob)
    .where(
      and(
        eq(calibrationJob.organizationId, organizationId),
        gte(calibrationJob.createdAt, startOfMonth),
      ),
    );

  // Count members
  const [memberResult] = await db
    .select({ count: count() })
    .from(member)
    .where(eq(member.organizationId, organizationId));

  // TODO: Calculate storage usage when file storage is implemented

  return {
    jobsCreated: certResult?.count ?? 0,
    users: memberResult?.count ?? 0,
    storage: 0, // Placeholder until storage tracking is implemented
  };
}
