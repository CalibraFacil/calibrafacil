import { Hono } from "hono";
import {
  withLabPermission,
  type AuthVariables,
} from "../../middleware/permission";
import { buildRevenueLeakage } from "../../lib/revenue-leakage";

export const financeRevenueLeakageRouter = new Hono<{
  Variables: AuthVariables;
}>().get("/", ...withLabPermission({ financial: ["read"] }), async (c) => {
  const member = c.get("member");
  const envelope = await buildRevenueLeakage({
    organizationId: member.organizationId,
    scope: member,
  });
  return c.json(envelope);
});
