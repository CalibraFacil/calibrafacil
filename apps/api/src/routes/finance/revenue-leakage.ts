import { createRouter } from "../../server/router";
import { orgDb } from "../../lib/org-db";
import {
  withLabPermission,
  type AuthVariables,
} from "../../middleware/permission";
import { buildRevenueLeakage } from "../../lib/revenue-leakage";

export const financeRevenueLeakageRouter = createRouter<{
  Variables: AuthVariables;
}>().get("/", ...withLabPermission({ financial: ["read"] }), async (c) => {
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
  return c.json(envelope);
});
