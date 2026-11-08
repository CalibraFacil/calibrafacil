import { createRouter } from "../../../server/router";
import { financeEndpoints } from "@calibra-facil/contracts";
import { mount } from "../../../lib/endpoint-mount";
import { orgDb } from "../../../lib/org-db";
import {
  withLabPermission,
  type AuthVariables,
} from "../../../middleware/permission";
import {
  OPERATIONS_TO_CASH_STAGES,
  type OperationsToCashStage,
} from "@calibra-facil/shared";
import { buildOperationsToCash } from "../operations-to-cash";

function parseStage(
  value: string | undefined,
): OperationsToCashStage | undefined {
  if (!value) return undefined;
  return OPERATIONS_TO_CASH_STAGES.find((stage) => stage === value);
}

const PREFIX = "/api/finance/operations-to-cash";

export const financeOperationsToCashRouter = createRouter<{
  Variables: AuthVariables;
}>();
mount(
  financeOperationsToCashRouter,
  PREFIX,
  financeEndpoints.getOperationsToCash,
  withLabPermission({ financial: ["read"] }),
  async (c, { query }) => {
    const member = c.get("member");
    const stageFilter = parseStage(query.stage);
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
    return envelope;
  },
);
