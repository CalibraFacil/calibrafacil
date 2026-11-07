import { createRouter } from "../../server/router";
import { accessEndpoints } from "@calibra-facil/contracts";
import {
  requireLabProtected,
  requireOrgType,
  type AuthVariables,
} from "../../middleware/permission";
import { mount } from "../../lib/endpoint-mount";

const PREFIX = "/api/finance/access";

export const financeAccessRouter = createRouter<{
  Variables: AuthVariables;
}>();

mount(
  financeAccessRouter,
  PREFIX,
  accessEndpoints.getFinanceAccess,
  [...requireLabProtected, requireOrgType("LAB")],
  async (c) => {
    const member = c.get("member");
    const canManageFinancial =
      member.role === "owner" || member.role === "admin";

    return {
      canReadFinancial: canManageFinancial,
      canManageFinancial,
      canExportFinancial: canManageFinancial,
      role: member.role,
    };
  },
);
