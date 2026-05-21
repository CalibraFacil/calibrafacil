import { db } from "@calibra-facil/db";
import { subscription } from "@calibra-facil/db/schema";
import {
  getEnabledEntitlements,
  getPlan,
  getPlanSupportPolicy,
  isSubscriptionActive,
  isValidPlanId,
  type FeatureFlag,
  type PlanId,
  type PlanSupportPolicy,
  type SubscriptionStatus,
} from "@calibra-facil/shared";
import { eq } from "drizzle-orm";

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

  return {
    planId,
    status,
    planName: plan.name,
    isActive,
    entitlements: isActive ? getEnabledEntitlements(planId) : [],
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
