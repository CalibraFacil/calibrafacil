import { Hono } from "hono";
import { db } from "@calibra-facil/db";
import { organization } from "@calibra-facil/db/schema";
import {
  hasPermissionLocally,
  requireLabProtected,
  requireOrgType,
  type AuthVariables,
} from "../../middleware/permission";
import { getOrganizationPlanAccess } from "../../lib/organization-plan";
import { eq } from "drizzle-orm";
import { getEffectivePlanLimits } from "@calibra-facil/shared";

export const billingAccessRouter = new Hono<{ Variables: AuthVariables }>().get(
  "/",
  ...requireLabProtected,
  requireOrgType("LAB"),
  async (c) => {
    const member = c.get("member");
    const access = await getOrganizationPlanAccess(member.organizationId);
    const currentOrganization = await db.query.organization.findFirst({
      columns: { createdAt: true },
      where: eq(organization.id, member.organizationId),
    });
    const limits = getEffectivePlanLimits(
      access.planId,
      currentOrganization?.createdAt,
    );

    return c.json({
      planId: access.planId,
      planName: access.planName,
      status: access.status,
      limits,
      entitlements: access.entitlements,
      hasFinancial: access.entitlements.includes("financial"),
      hasFinancialModule: access.entitlements.includes("financial"),
      // The real permissions, not constants, and split because the roles are:
      // ADMIN holds billing:["read"] without "update". Reporting one flag as
      // true for everyone put an enabled purchase button in front of a role
      // whose every mutation the API rejects.
      canViewBilling: hasPermissionLocally(member.role, { billing: ["read"] }),
      canManageBilling: hasPermissionLocally(member.role, {
        billing: ["update"],
      }),
      hasApi: access.entitlements.includes("api"),
      hasCustomDomain: access.entitlements.includes("custom_domain"),
      hasSso: access.entitlements.includes("sso"),
    });
  },
);
