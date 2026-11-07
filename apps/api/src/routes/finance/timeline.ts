import { createRouter } from "../../server/router";
import { parseNumericRouteIdentifier } from "@calibra-facil/shared/route-identifiers";
import {
  buildCustomerFinancialTimeline,
  buildServiceOrderFinancialStatus,
} from "../../lib/financial-timeline";
import {
  withLabPermission,
  type AuthVariables,
} from "../../middleware/permission";
import { resolveCustomerRouteId } from "../../lib/customer-route-id";
import { invalid, notFound } from "../../lib/domain-errors";
import { orgDb } from "../../lib/org-db";

function parseStrictPositiveInt(value: string | undefined) {
  if (!value) return null;
  return parseNumericRouteIdentifier(value);
}

const CUSTOMER_TIMELINE_MAX_LIMIT = 50;

export const financeTimelineRouter = createRouter<{
  Variables: AuthVariables;
}>()
  .get(
    "/service-orders/:serviceOrderId/status",
    ...withLabPermission({ financial: ["read"] }),
    async (c) => {
      const member = c.get("member");
      const serviceOrderId = parseStrictPositiveInt(
        c.req.param("serviceOrderId"),
      );
      if (!serviceOrderId) {
        throw invalid("invalid_request", "ID da ordem de serviço inválido");
      }

      const data = await orgDb(member.organizationId).transaction((o) =>
        buildServiceOrderFinancialStatus({
          executor: o,
          organizationId: member.organizationId,
          scope: member,
          serviceOrderId,
          includeProviderEvidence: true,
        }),
      );

      if (!data) {
        throw notFound(
          "service_order_not_found",
          "Ordem de serviço não encontrada",
        );
      }

      return c.json({ data });
    },
  )
  .get(
    "/customers/:customerId/timeline",
    ...withLabPermission({ financial: ["read"] }),
    async (c) => {
      const member = c.get("member");
      const customerRouteId = c.req.param("customerId");
      const customerId = customerRouteId
        ? await orgDb(member.organizationId).transaction((o) =>
            resolveCustomerRouteId(customerRouteId, member.organizationId, o),
          )
        : null;
      const limitParam = c.req.query("limit");
      const limit = limitParam ? parseStrictPositiveInt(limitParam) : null;
      if (!customerId) {
        throw notFound("customer_not_found", "Cliente não encontrado");
      }
      if (limitParam && !limit) {
        throw invalid("invalid_limit", "Limite inválido");
      }

      const timeline = await orgDb(member.organizationId).transaction((o) =>
        buildCustomerFinancialTimeline({
          executor: o,
          organizationId: member.organizationId,
          scope: member,
          customerId,
          limit: limit
            ? Math.min(limit, CUSTOMER_TIMELINE_MAX_LIMIT)
            : undefined,
          includeProviderEvidence: true,
        }),
      );

      if (!timeline) {
        throw notFound("customer_not_found", "Cliente não encontrado");
      }

      return c.json({ data: timeline });
    },
  );
