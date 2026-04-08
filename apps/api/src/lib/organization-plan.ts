import { db } from "@calibra-facil/db";
import { subscription } from "@calibra-facil/db/schema";
import {
  getEnabledEntitlements,
  getPlan,
  isSubscriptionActive,
  type FeatureFlag,
  type PlanId,
  type SubscriptionStatus,
} from "@calibra-facil/shared";
import { eq } from "drizzle-orm";

export interface OrganizationPlanAccess {
  planId: PlanId;
  status: SubscriptionStatus;
  planName: string;
  isActive: boolean;
  entitlements: FeatureFlag[];
}

export async function getOrganizationPlanAccess(
  organizationId: string,
): Promise<OrganizationPlanAccess> {
  const currentSubscription = await db.query.subscription.findFirst({
    where: eq(subscription.organizationId, organizationId),
  });

  const planId = (currentSubscription?.planId as PlanId | undefined) ?? "FREE";
  const status =
    (currentSubscription?.status as SubscriptionStatus | undefined) ?? "TRIAL";
  const plan = getPlan(planId);
  const isActive = currentSubscription ? isSubscriptionActive(status) : true;

  return {
    planId,
    status,
    planName: plan.name,
    isActive,
    entitlements: isActive ? getEnabledEntitlements(planId) : [],
  };
}

export async function organizationHasEntitlement(
  organizationId: string,
  entitlement: FeatureFlag,
): Promise<boolean> {
  const access = await getOrganizationPlanAccess(organizationId);
  return access.isActive && access.entitlements.includes(entitlement);
}
