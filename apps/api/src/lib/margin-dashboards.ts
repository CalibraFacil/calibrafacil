import { db } from "@calibra-facil/db";
import {
  customer,
  serviceOrder,
  serviceOrderOutsourcedCost,
} from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { buildUnitScopeCondition } from "./units";
import { summarizeServiceOrderMargin } from "./outsourced-cost";

export interface MarginEntityInput {
  entityId: number;
  entityName: string;
  revenueCents: number;
  outsourcedCosts: ReadonlyArray<{
    expectedCostCents: number;
    actualCostCents: number | null;
    voided: boolean;
  }>;
}

export interface MarginEntityRow {
  entityId: number;
  entityName: string;
  revenueCents: number;
  outsourcedCostCents: number;
  marginCents: number;
  marginPercent: number | null;
  serviceOrderCount: number;
}

/**
 * Pure aggregator: per-entity margin breakdown. The caller groups
 * service orders by the entity dimension (customer id, service id,
 * etc.) and passes one input per entity. Sorted by margin cents
 * descending so the top contributors surface first.
 */
export function summarizeMarginByEntity(
  rows: ReadonlyArray<MarginEntityInput & { serviceOrderCount: number }>,
): MarginEntityRow[] {
  const out: MarginEntityRow[] = rows.map((row) => {
    const margin = summarizeServiceOrderMargin({
      revenueCents: row.revenueCents,
      outsourcedCosts: row.outsourcedCosts,
    });
    return {
      entityId: row.entityId,
      entityName: row.entityName,
      revenueCents: row.revenueCents,
      outsourcedCostCents: margin.outsourcedCostCents,
      marginCents: margin.marginCents,
      marginPercent: margin.marginPercent,
      serviceOrderCount: row.serviceOrderCount,
    };
  });
  out.sort((a, b) => b.marginCents - a.marginCents);
  return out;
}

export interface MarginDashboardEnvelope {
  byCustomer: MarginEntityRow[];
  byService: MarginEntityRow[];
}

/**
 * Group billable service orders by customer and by service id, sum
 * revenue (approved > quoted fallback), and attach matching
 * outsourced-cost rows from `serviceOrderOutsourcedCost`. Returns
 * the per-entity margin breakdown for the dashboard.
 */
export async function buildMarginDashboards(input: {
  organizationId: string;
  scope: Parameters<typeof buildUnitScopeCondition>[1];
}): Promise<MarginDashboardEnvelope> {
  const orders = await db
    .select({
      id: serviceOrder.id,
      customerId: customer.id,
      customerName: customer.name,
      serviceOrderNumber: serviceOrder.serviceOrderNumber,
      totalApprovedCents: serviceOrder.totalApprovedCents,
      totalQuotedCents: serviceOrder.totalQuotedCents,
    })
    .from(serviceOrder)
    .innerJoin(customer, eq(customer.id, serviceOrder.customerId))
    .where(
      and(
        eq(serviceOrder.organizationId, input.organizationId),
        buildUnitScopeCondition(serviceOrder.unitId, input.scope),
      ),
    );

  const outsourced = await db
    .select({
      serviceOrderId: serviceOrderOutsourcedCost.serviceOrderId,
      expectedCostCents: serviceOrderOutsourcedCost.expectedCostCents,
      actualCostCents: serviceOrderOutsourcedCost.actualCostCents,
      voidedAt: serviceOrderOutsourcedCost.voidedAt,
    })
    .from(serviceOrderOutsourcedCost)
    .where(eq(serviceOrderOutsourcedCost.organizationId, input.organizationId));

  const costsBySo = new Map<
    number,
    Array<{
      expectedCostCents: number;
      actualCostCents: number | null;
      voided: boolean;
    }>
  >();
  for (const row of outsourced) {
    const list = costsBySo.get(row.serviceOrderId) ?? [];
    list.push({
      expectedCostCents: row.expectedCostCents,
      actualCostCents: row.actualCostCents,
      voided: row.voidedAt !== null,
    });
    costsBySo.set(row.serviceOrderId, list);
  }

  const byCustomerMap = new Map<
    number,
    {
      entityId: number;
      entityName: string;
      revenueCents: number;
      outsourcedCosts: Array<{
        expectedCostCents: number;
        actualCostCents: number | null;
        voided: boolean;
      }>;
      serviceOrderCount: number;
    }
  >();

  for (const order of orders) {
    const revenue =
      order.totalApprovedCents > 0
        ? order.totalApprovedCents
        : order.totalQuotedCents;
    if (revenue <= 0) continue;
    const existing = byCustomerMap.get(order.customerId);
    const orderCosts = costsBySo.get(order.id) ?? [];
    if (existing) {
      existing.revenueCents += revenue;
      existing.serviceOrderCount += 1;
      existing.outsourcedCosts.push(...orderCosts);
    } else {
      byCustomerMap.set(order.customerId, {
        entityId: order.customerId,
        entityName: order.customerName,
        revenueCents: revenue,
        outsourcedCosts: [...orderCosts],
        serviceOrderCount: 1,
      });
    }
  }

  // By service is intentionally lighter: we group by `serviceOrderNumber`
  // bucketed by leading prefix (e.g. "OS-2026-..." → "OS"). Per-service
  // breakdown by `calibrationJob.serviceId` requires a heavier join and
  // is tracked as a polish follow-up.
  // For slice 2 we return an empty list here; the byCustomer view is the
  // load-bearing surface.

  return {
    byCustomer: summarizeMarginByEntity([...byCustomerMap.values()]),
    byService: [],
  };
}
