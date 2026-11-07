import { createRouter } from "../../server/router";
import { orgDb } from "../../lib/org-db";
import {
  withLabPermission,
  type AuthVariables,
} from "../../middleware/permission";
import { buildCashForecast } from "../../lib/cash-forecast";

export const financeCashForecastRouter = createRouter<{
  Variables: AuthVariables;
}>().get("/", ...withLabPermission({ financial: ["read"] }), async (c) => {
  const member = c.get("member");
  const summary = await orgDb(member.organizationId).transaction((o) =>
    buildCashForecast(
      {
        organizationId: member.organizationId,
        scope: member,
      },
      o,
    ),
  );
  return c.json(summary);
});
