import { db } from "@calibra-facil/db";
import { entitlementOverride, subscription } from "@calibra-facil/db/schema";
import {
  getEnabledEntitlements,
  getPlan,
  getPlanSupportPolicy,
  isFeatureFlag,
  isSubscriptionActive,
  isValidPlanId,
  type FeatureFlag,
  type PlanId,
  type PlanSupportPolicy,
  type SubscriptionStatus,
} from "@calibra-facil/shared";
import { and, eq, gt, isNull, or } from "drizzle-orm";

export interface OrganizationPlanAccess {
  planId: PlanId;
  status: SubscriptionStatus;
  planName: string;
  isActive: boolean;
  entitlements: FeatureFlag[];
  supportPolicy: PlanSupportPolicy;
}

export async function getOrganizationPlanAccess(
  organizationId: string,
): Promise<OrganizationPlanAccess> {
  const currentSubscription = await db.query.subscription.findFirst({
    where: eq(subscription.organizationId, organizationId),
  });

  const planIdValue = currentSubscription?.planId ?? "";
  const planId = isValidPlanId(planIdValue) ? planIdValue : "FREE";
  const status = parseSubscriptionStatus(currentSubscription?.status);
  const plan = getPlan(planId);
  const isActive = currentSubscription ? isSubscriptionActive(status) : true;

  // Backoffice entitlement overrides are grant-only: they add features on top of
  // the plan (comps, upsell trials) and never remove a plan entitlement. Applied
  // even to inactive subscriptions so a comp can grant access to a free/lapsed org.
  const baseEntitlements = isActive ? getEnabledEntitlements(planId) : [];
  const overrideRows = await db
    .select({ feature: entitlementOverride.feature })
    .from(entitlementOverride)
    .where(
      and(
        eq(entitlementOverride.organizationId, organizationId),
        or(
          isNull(entitlementOverride.expiresAt),
          gt(entitlementOverride.expiresAt, new Date()),
        ),
      ),
    );
  const grantedFeatures = overrideRows
    .map((row) => row.feature)
    .filter(isFeatureFlag);
  const entitlements: FeatureFlag[] = Array.from(
    new Set([...baseEntitlements, ...grantedFeatures]),
  );

  return {
    planId,
    status,
    planName: plan.name,
    isActive,
    entitlements,
    supportPolicy: getPlanSupportPolicy(planId),
  };
}

function parseSubscriptionStatus(
  status: string | null | undefined,
): SubscriptionStatus {
  switch (status) {
    case "ACTIVE":
    case "PAST_DUE":
    case "CANCELED":
    case "TRIAL":
      return status;
    default:
      return "TRIAL";
  }
}

export async function organizationHasEntitlement(
  organizationId: string,
  entitlement: FeatureFlag,
): Promise<boolean> {
  const access = await getOrganizationPlanAccess(organizationId);
  return access.isActive && access.entitlements.includes(entitlement);
}
