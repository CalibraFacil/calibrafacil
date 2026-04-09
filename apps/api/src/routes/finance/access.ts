import { Hono } from "hono";
import {
  requireLabProtected,
  requireOrgType,
  type AuthVariables,
} from "../../middleware/permission";
import { getOrganizationPlanAccess } from "../../lib/organization-plan";

export const financeAccessRouter = new Hono<{ Variables: AuthVariables }>().get(
  "/",
  ...requireLabProtected,
  requireOrgType("LAB"),
  async (c) => {
    const member = c.get("member");
    const access = await getOrganizationPlanAccess(member.organizationId);
    const canManageFinancial = member.role === "owner" || member.role === "admin";

    return c.json({
      planId: access.planId,
      planName: access.planName,
      status: access.status,
      entitlements: access.entitlements,
      hasFinancialModule: access.entitlements.includes("financial"),
      hasCustomIntegrations: access.entitlements.includes("custom_integrations"),
      canReadFinancial: canManageFinancial,
      canManageFinancial,
      canExportFinancial: canManageFinancial,
      role: member.role,
    });
  },
);
