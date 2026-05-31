import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { BillingReadinessStatus } from "@calibra-facil/shared";
import { getOrganizationPlanAccess } from "../../lib/organization-plan";
import { computeBillingReadinessQueue } from "../../lib/billing-readiness";
import { sendServiceOrdersToFinance } from "../../lib/finance";
import type { IntegrationsEnv } from "../../lib/integrations";
import { withInvalidation } from "../../middleware/cache";
import {
  withLabPermission,
  type AuthVariables,
} from "../../middleware/permission";
import { requireFeature } from "../../middleware/tier-guard";

const SendSchema = z.object({
  serviceOrderIds: z.array(z.number().int().positive()).min(1).max(50),
});

const READINESS_STATUSES: BillingReadinessStatus[] = [
  "READY",
  "BLOCKED",
  "BILLED",
  "SENT",
];

function parseStatusFilter(value: string | undefined) {
  return READINESS_STATUSES.find((status) => status === value);
}

export const financeBillingReadinessRouter = new Hono<{
  Variables: AuthVariables;
  Bindings: IntegrationsEnv;
}>()
  .get(
    "/",
    ...withLabPermission({ financial: ["read"] }),
    requireFeature("financial"),
    async (c) => {
      const member = c.get("member");
      const access = await getOrganizationPlanAccess(member.organizationId);

      const statusFilter = parseStatusFilter(c.req.query("status"));
      const customerIdRaw = c.req.query("customerId");
      const customerId = customerIdRaw
        ? Number.parseInt(customerIdRaw, 10)
        : undefined;

      const queue = await computeBillingReadinessQueue({
        organizationId: member.organizationId,
        scope: member,
        filters: {
          status: statusFilter,
          customerId:
            customerId && Number.isInteger(customerId) ? customerId : undefined,
        },
      });

      return c.json({
        billing: {
          planId: access.planId,
          planName: access.planName,
          hasFinancialIntegrations: access.entitlements.includes(
            "financial_integrations",
          ),
          integrationState: queue.integrationState,
        },
        summary: queue.summary,
        data: queue.items,
      });
    },
  )
  .post(
    "/send",
    ...withLabPermission({ financial: ["export"] }),
    requireFeature("financial"),
    requireFeature("financial_integrations"),
    withInvalidation("finance"),
    zValidator("json", SendSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const { serviceOrderIds } = c.req.valid("json");

      const results = await sendServiceOrdersToFinance({
        organizationId: member.organizationId,
        serviceOrderIds,
        actorUserId: session.user.id,
        scope: member,
        env: c.env,
      });

      return c.json({ data: results });
    },
  );
