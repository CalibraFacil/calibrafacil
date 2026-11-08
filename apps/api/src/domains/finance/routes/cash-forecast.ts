import { createRouter } from "../../../server/router";
import { financeEndpoints } from "@calibra-facil/contracts";
import { mount } from "../../../lib/endpoint-mount";
import { orgDb } from "../../../lib/org-db";
import { type AuthVariables } from "../../../middleware/permission";
import { buildCashForecast } from "../cash-forecast";

const PREFIX = "/api/finance/cash-forecast";

export const financeCashForecastRouter = createRouter<{
  Variables: AuthVariables;
}>();
mount(
  financeCashForecastRouter,
  PREFIX,
  financeEndpoints.getCashForecast,
  async (c) => {
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
    return summary;
  },
);
