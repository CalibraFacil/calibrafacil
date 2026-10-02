import { Hono } from "hono";
import {
  withLabPermission,
  type AuthVariables,
} from "../../middleware/permission";
import { buildCashForecast } from "../../lib/cash-forecast";

export const financeCashForecastRouter = new Hono<{
  Variables: AuthVariables;
}>().get("/", ...withLabPermission({ financial: ["read"] }), async (c) => {
  const member = c.get("member");
  const summary = await buildCashForecast({
    organizationId: member.organizationId,
    scope: member,
  });
  return c.json(summary);
});
