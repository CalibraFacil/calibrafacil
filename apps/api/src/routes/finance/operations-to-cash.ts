import { createRouter } from "../../server/router";
import { orgDb } from "../../lib/org-db";
import {
  withLabPermission,
  type AuthVariables,
} from "../../middleware/permission";
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

export const financeOperationsToCashRouter = createRouter<{
  Variables: AuthVariables;
}>().get("/", ...withLabPermission({ financial: ["read"] }), async (c) => {
  const member = c.get("member");
  const stageFilter = parseStage(c.req.query("stage"));
  const envelope = await orgDb(member.organizationId).transaction((o) =>
    buildOperationsToCash(
      {
        organizationId: member.organizationId,
        scope: member,
        stageFilter,
      },
      o,
    ),
  );
  return c.json(envelope);
});
