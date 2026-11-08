import { createRouter } from "../../../server/router";
import { financeEndpoints } from "@calibra-facil/contracts";
import { mount } from "../../../lib/endpoint-mount";
import { orgDb } from "../../../lib/org-db";
import { type AuthVariables } from "../../../middleware/permission";
import { buildMarginDashboards } from "../margin-dashboards";

const PREFIX = "/api/finance/margin-dashboards";

export const financeMarginDashboardsRouter = createRouter<{
  Variables: AuthVariables;
}>();
mount(
  financeMarginDashboardsRouter,
  PREFIX,
  financeEndpoints.getMarginDashboards,
  async (c) => {
    const member = c.get("member");
    const envelope = await orgDb(member.organizationId).transaction((o) =>
      buildMarginDashboards(
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
