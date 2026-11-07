import { createRouter } from "../../server/router";
import {
  requireLabProtected,
  requireOrgType,
  type AuthVariables,
} from "../../middleware/permission";

export const financeAccessRouter = createRouter<{
  Variables: AuthVariables;
}>().get("/", ...requireLabProtected, requireOrgType("LAB"), async (c) => {
  const member = c.get("member");
  const canManageFinancial = member.role === "owner" || member.role === "admin";

  return c.json({
    canReadFinancial: canManageFinancial,
    canManageFinancial,
    canExportFinancial: canManageFinancial,
    role: member.role,
  });
});
