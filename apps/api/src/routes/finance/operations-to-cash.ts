import { Hono } from "hono";
import {
  withLabPermission,
  type AuthVariables,
} from "../../middleware/permission";
import { requireFeature } from "../../middleware/tier-guard";
import {
  buildOperationsToCash,
  OPERATIONS_TO_CASH_STAGES,
  type OperationsToCashStage,
} from "../../lib/operations-to-cash";

function parseStage(
  value: string | undefined,
): OperationsToCashStage | undefined {
  if (!value) return undefined;
  return OPERATIONS_TO_CASH_STAGES.find((stage) => stage === value);
}

export const financeOperationsToCashRouter = new Hono<{
  Variables: AuthVariables;
}>().get(
  "/",
  ...withLabPermission({ financial: ["read"] }),
  requireFeature("financial"),
  async (c) => {
    const member = c.get("member");
    const stageFilter = parseStage(c.req.query("stage"));
    const envelope = await buildOperationsToCash({
      organizationId: member.organizationId,
      scope: member,
      stageFilter,
    });
    return c.json(envelope);
  },
);
