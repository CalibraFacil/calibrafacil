import { createRouter } from "../../../server/router";
import { financeEndpoints } from "@calibra-facil/contracts";
import { mount } from "../../../lib/endpoint-mount";
import { parseNumericRouteIdentifier } from "@calibra-facil/shared/route-identifiers";
import {
  buildCustomerFinancialTimeline,
  buildServiceOrderFinancialStatus,
} from "../financial-timeline";
import {
  withLabPermission,
  type AuthVariables,
} from "../../../middleware/permission";
import { resolveCustomerRouteId } from "../../../lib/customer-route-id";
import { invalid, notFound } from "../../../lib/domain-errors";
import { orgDb } from "../../../lib/org-db";

function parseStrictPositiveInt(value: string | undefined) {
  if (!value) return null;
  return parseNumericRouteIdentifier(value);
}

const CUSTOMER_TIMELINE_MAX_LIMIT = 50;

const PREFIX = "/api/finance";

export const financeTimelineRouter = createRouter<{
  Variables: AuthVariables;
}>();
mount(
  financeTimelineRouter,
  PREFIX,
  financeEndpoints.getServiceOrderStatus,
  withLabPermission({ financial: ["read"] }),
  async (c, { params }) => {
    const member = c.get("member");
    const { serviceOrderId } = params;

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

    return { data };
  },
);
mount(
  financeTimelineRouter,
  PREFIX,
  financeEndpoints.getCustomerTimeline,
  withLabPermission({ financial: ["read"] }),
  async (c, { params, query }) => {
    const member = c.get("member");
    const customerRouteId = params.customerId;
    const customerId = customerRouteId
      ? await orgDb(member.organizationId).transaction((o) =>
          resolveCustomerRouteId(customerRouteId, member.organizationId, o),
        )
      : null;
    const limitParam = query.limit;
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
        limit: limit ? Math.min(limit, CUSTOMER_TIMELINE_MAX_LIMIT) : undefined,
        includeProviderEvidence: true,
      }),
    );

    if (!timeline) {
      throw notFound("customer_not_found", "Cliente não encontrado");
    }

    return { data: timeline };
  },
);
