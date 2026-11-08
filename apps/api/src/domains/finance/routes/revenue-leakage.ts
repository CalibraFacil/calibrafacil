import { createRouter } from "../../../server/router";
import { financeEndpoints } from "@calibra-facil/contracts";
import { mount } from "../../../lib/endpoint-mount";
import { orgDb } from "../../../lib/org-db";
import { type AuthVariables } from "../../../middleware/permission";
import { buildRevenueLeakage } from "../revenue-leakage";

const PREFIX = "/api/finance/revenue-leakage";

export const financeRevenueLeakageRouter = createRouter<{
  Variables: AuthVariables;
}>();
mount(
  financeRevenueLeakageRouter,
  PREFIX,
  financeEndpoints.getRevenueLeakage,
  async (c) => {
    const member = c.get("member");
    const envelope = await orgDb(member.organizationId).transaction((o) =>
      buildRevenueLeakage(
        {
          organizationId: member.organizationId,
          scope: member,
        },
        o,
      ),
    );
    return envelope;
  },
);
