import { createRouter } from "../../server/router";
import { orgDb } from "../../lib/org-db";
import {
  withLabPermission,
  type AuthVariables,
} from "../../middleware/permission";
import { buildMarginDashboards } from "../../lib/margin-dashboards";

export const financeMarginDashboardsRouter = createRouter<{
  Variables: AuthVariables;
}>().get("/", ...withLabPermission({ financial: ["read"] }), async (c) => {
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
  return c.json(envelope);
});
