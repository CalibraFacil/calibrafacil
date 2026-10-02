import { Hono } from "hono";
import {
  withLabPermission,
  type AuthVariables,
} from "../../middleware/permission";
import { buildMarginDashboards } from "../../lib/margin-dashboards";

export const financeMarginDashboardsRouter = new Hono<{
  Variables: AuthVariables;
}>().get("/", ...withLabPermission({ financial: ["read"] }), async (c) => {
  const member = c.get("member");
  const envelope = await buildMarginDashboards({
    organizationId: member.organizationId,
    scope: member,
  });
  return c.json(envelope);
});
