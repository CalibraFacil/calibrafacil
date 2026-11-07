import { createRouter } from "../../../server/router";
import { financeEndpoints } from "@calibra-facil/contracts";
import { mount } from "../../../lib/endpoint-mount";
import { orgDb } from "../../../lib/org-db";
import type { BillingReadinessStatus } from "@calibra-facil/shared";
import { computeBillingReadinessQueue } from "../billing-readiness";
import { sendServiceOrdersToFinance } from "../finance";
import type { IntegrationsEnv } from "../integrations";
import {
  withLabPermission,
  type AuthVariables,
} from "../../../middleware/permission";

const READINESS_STATUSES: BillingReadinessStatus[] = [
  "READY",
  "BLOCKED",
  "BILLED",
  "SENT",
];

function parseStatusFilter(value: string | undefined) {
  return READINESS_STATUSES.find((status) => status === value);
}

const PREFIX = "/api/finance/billing-readiness";

export const financeBillingReadinessRouter = createRouter<{
  Variables: AuthVariables;
  Bindings: IntegrationsEnv;
}>();
mount(
  financeBillingReadinessRouter,
  PREFIX,
  financeEndpoints.listBillingReadiness,
  withLabPermission({ financial: ["read"] }),
  async (c, { query }) => {
    const member = c.get("member");

    const statusFilter = parseStatusFilter(query.status);
    const customerIdRaw = query.customerId;
    const customerId = customerIdRaw
      ? Number.parseInt(customerIdRaw, 10)
      : undefined;

    const queue = await orgDb(member.organizationId).transaction((o) =>
      computeBillingReadinessQueue(
        {
          organizationId: member.organizationId,
          scope: member,
          filters: {
            status: statusFilter,
            customerId:
              customerId && Number.isInteger(customerId)
                ? customerId
                : undefined,
          },
        },
        o,
      ),
    );

    return {
      billing: {
        integrationState: queue.integrationState,
      },
      summary: queue.summary,
      data: queue.items,
    };
  },
);
mount(
  financeBillingReadinessRouter,
  PREFIX,
  financeEndpoints.sendBillingReadiness,
  withLabPermission({ financial: ["export"] }),
  async (c, { body: { serviceOrderIds } }) => {
    const member = c.get("member");
    const session = c.get("session");

    const results = await sendServiceOrdersToFinance({
      organizationId: member.organizationId,
      serviceOrderIds,
      actorUserId: session.user.id,
      scope: member,
      env: c.env,
    });

    return { data: results };
  },
);
