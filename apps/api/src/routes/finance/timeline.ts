import { Hono } from "hono";
import {
  buildCustomerFinancialTimeline,
  buildServiceOrderFinancialStatus,
} from "../../lib/financial-timeline";
import {
  withLabPermission,
  type AuthVariables,
} from "../../middleware/permission";
import { requireFeature } from "../../middleware/tier-guard";
import { resolveCustomerRouteId } from "../../lib/customer-route-id";
import { parseLegacyNumericIdentifier } from "../../lib/route-identifiers";

function parseStrictPositiveInt(value: string | undefined) {
  if (!value) return null;
  return parseLegacyNumericIdentifier(value);
}

const CUSTOMER_TIMELINE_MAX_LIMIT = 50;

export const financeTimelineRouter = new Hono<{
  Variables: AuthVariables;
}>()
  .get(
    "/service-orders/:serviceOrderId/status",
    ...withLabPermission({ financial: ["read"] }),
    requireFeature("financial"),
    requireFeature("financial_integrations"),
    async (c) => {
      const member = c.get("member");
      const serviceOrderId = parseStrictPositiveInt(
        c.req.param("serviceOrderId"),
      );
      if (!serviceOrderId) {
        return c.json({ error: "ID da ordem de serviço inválido" }, 400);
      }

      const data = await buildServiceOrderFinancialStatus({
        organizationId: member.organizationId,
        scope: member,
        serviceOrderId,
        includeProviderEvidence: true,
      });

      if (!data) {
        return c.json({ error: "Ordem de serviço não encontrada" }, 404);
      }

      return c.json({ data });
    },
  )
  .get(
    "/customers/:customerId/timeline",
    ...withLabPermission({ financial: ["read"] }),
    requireFeature("financial"),
    requireFeature("financial_integrations"),
    async (c) => {
      const member = c.get("member");
      const customerRouteId = c.req.param("customerId");
      const customerId = customerRouteId
        ? await resolveCustomerRouteId(customerRouteId, member.organizationId)
        : null;
      const limitParam = c.req.query("limit");
      const limit = limitParam ? parseStrictPositiveInt(limitParam) : null;
      if (!customerId) {
        return c.json({ error: "Cliente não encontrado" }, 404);
      }
      if (limitParam && !limit) {
        return c.json({ error: "Limite inválido" }, 400);
      }

      const timeline = await buildCustomerFinancialTimeline({
        organizationId: member.organizationId,
        scope: member,
        customerId,
        limit: limit ? Math.min(limit, CUSTOMER_TIMELINE_MAX_LIMIT) : undefined,
        includeProviderEvidence: true,
      });

      if (!timeline) {
        return c.json({ error: "Cliente não encontrado" }, 404);
      }

      return c.json({ data: timeline });
    },
  );
