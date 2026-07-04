import { APIError } from "better-auth/api";
import { getDb } from "@calibra-facil/db";
import * as schema from "@calibra-facil/db/schema";
import { and, count, eq, gt } from "drizzle-orm";
import {
  getEffectivePlanLimits,
  getPlan,
  isValidPlanId,
  type PlanId,
} from "@calibra-facil/shared";

// =============================================================================
// PLAN USER-LIMIT ENFORCEMENT (DOM-07)
// =============================================================================
//
// Enforce the plan's `users` limit on the invite / add-member path. Member
// invites go through Better Auth's organization plugin (not a custom Hono
// route), so the enforcement is wired into the plugin's `beforeCreateInvitation`
// and `beforeAddMember` hooks (see `createOrganizationPlugin` in auth.ts).
//
// This mirrors how `apps/api/src/middleware/tier-guard.ts` resolves a plan and
// its limits — same single source of truth in `@calibra-facil/shared`
// (`getEffectivePlanLimits`) — but lives in `@calibra-facil/auth` because that
// is where the invite actually happens (apps/api cannot be imported here).
//
// Counting semantic (REQ-DOM-USR-003): PROVISIONED SEATS. Usage = active members
// PLUS still-pending, non-expired invitations. Pending invitations MUST count,
// otherwise the limit is unenforceable at invite time — every individual invite
// would pass (member count only grows on acceptance) and an org could provision
// arbitrarily many seats that all blow past the limit once accepted.

/**
 * Count provisioned user "seats" for an organization: active members PLUS
 * still-pending, non-expired invitations.
 */
export async function getOrganizationProvisionedUserCount(
  organizationId: string,
): Promise<number> {
  const db = getDb();

  const [memberRow] = await db
    .select({ value: count() })
    .from(schema.member)
    .where(eq(schema.member.organizationId, organizationId));

  const [pendingRow] = await db
    .select({ value: count() })
    .from(schema.invitation)
    .where(
      and(
        eq(schema.invitation.organizationId, organizationId),
        eq(schema.invitation.status, "pending"),
        gt(schema.invitation.expiresAt, new Date()),
      ),
    );

  return (memberRow?.value ?? 0) + (pendingRow?.value ?? 0);
}

function toPlanId(value: unknown): PlanId {
  return typeof value === "string" && isValidPlanId(value) ? value : "FREE";
}

/**
 * Throw a 402 `LIMIT_EXCEEDED` (Better Auth `APIError`, matching the tier-guard
 * error shape) when adding `addingCount` seats to `organizationId` would exceed
 * the org's effective plan user limit. Resolves otherwise.
 *
 * Scope: LAB organizations only. CLIENT (customer portal) organizations are
 * system-owned and NOT billed on these plans; enforcing FREE=1 on them would
 * break portal member provisioning, so they are exempt.
 */
export async function assertOrganizationUserLimit(
  organizationId: string,
  addingCount = 1,
): Promise<void> {
  const db = getDb();
  const requested = Math.max(0, addingCount);

  const organization = await db.query.organization.findFirst({
    columns: { createdAt: true, type: true },
    where: eq(schema.organization.id, organizationId),
  });

  // Only LAB organizations are subject to the SaaS plan user limit.
  if (!organization || organization.type !== "LAB") {
    return;
  }

  const subscription = await db.query.subscription.findFirst({
    columns: { planId: true },
    where: eq(schema.subscription.organizationId, organizationId),
  });

  const planId = toPlanId(subscription?.planId);
  const limit = getEffectivePlanLimits(planId, organization.createdAt).users;

  const usage = await getOrganizationProvisionedUserCount(organizationId);
  const projected = usage + requested;

  if (projected > limit) {
    const plan = getPlan(planId);
    throw new APIError("PAYMENT_REQUIRED", {
      message: `Limite de usuarios atingido (${usage}/${limit}). Faca upgrade para o proximo plano.`,
      code: "LIMIT_EXCEEDED",
      cause: {
        code: "LIMIT_EXCEEDED",
        resource: "users",
        current: usage,
        requested,
        projected,
        limit,
        planId,
        planName: plan.name,
      },
    });
  }
}
