import { db } from "@calibra-facil/db";
import {
  serviceOrderOutsourcedCost,
} from "@calibra-facil/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";

export interface ServiceOrderMarginInput {
  revenueCents: number;
  outsourcedCosts: ReadonlyArray<{
    expectedCostCents: number;
    actualCostCents: number | null;
    voided: boolean;
  }>;
}

export interface ServiceOrderMargin {
  revenueCents: number;
  expectedCostCents: number;
  actualCostCents: number;
  outsourcedCostCents: number;
  marginCents: number;
  marginPercent: number | null;
}

/**
 * Pure margin computation. `outsourcedCostCents` is the best-known cost
 * (actual when available, otherwise expected), so the margin pill
 * stays meaningful even before Conta Azul reconciles the payable.
 */
export function summarizeServiceOrderMargin(
  input: ServiceOrderMarginInput,
): ServiceOrderMargin {
  let expectedCostCents = 0;
  let actualCostCents = 0;
  let bestKnownCostCents = 0;

  for (const row of input.outsourcedCosts) {
    if (row.voided) continue;
    expectedCostCents += row.expectedCostCents;
    if (row.actualCostCents !== null) {
      actualCostCents += row.actualCostCents;
      bestKnownCostCents += row.actualCostCents;
    } else {
      bestKnownCostCents += row.expectedCostCents;
    }
  }

  const marginCents = input.revenueCents - bestKnownCostCents;
  const marginPercent =
    input.revenueCents > 0
      ? Math.round((marginCents / input.revenueCents) * 10_000) / 100
      : null;

  return {
    revenueCents: input.revenueCents,
    expectedCostCents,
    actualCostCents,
    outsourcedCostCents: bestKnownCostCents,
    marginCents,
    marginPercent,
  };
}

export async function listOutsourcedCostsForServiceOrder(params: {
  organizationId: string;
  serviceOrderId: number;
}) {
  return db
    .select({
      id: serviceOrderOutsourcedCost.id,
      supplierName: serviceOrderOutsourcedCost.supplierName,
      expectedCostCents: serviceOrderOutsourcedCost.expectedCostCents,
      actualCostCents: serviceOrderOutsourcedCost.actualCostCents,
      currency: serviceOrderOutsourcedCost.currency,
      payableLinkId: serviceOrderOutsourcedCost.payableLinkId,
      notes: serviceOrderOutsourcedCost.notes,
      voidedAt: serviceOrderOutsourcedCost.voidedAt,
      createdAt: serviceOrderOutsourcedCost.createdAt,
      updatedAt: serviceOrderOutsourcedCost.updatedAt,
    })
    .from(serviceOrderOutsourcedCost)
    .where(
      and(
        eq(serviceOrderOutsourcedCost.organizationId, params.organizationId),
        eq(serviceOrderOutsourcedCost.serviceOrderId, params.serviceOrderId),
      ),
    )
    .orderBy(serviceOrderOutsourcedCost.id);
}

/**
 * Attempt to match a Conta Azul payable link to an outstanding
 * outsourced-cost row for the same organization via case-insensitive
 * supplier-name equality. Called by the existing payable-poll hook.
 * Read-only with respect to local-only operational data; only writes
 * to `service_order_outsourced_cost`.
 */
export async function reconcileOutsourcedCostWithPayable(params: {
  organizationId: string;
  payableLinkId: string;
  supplierName: string;
  amountCents: number;
}): Promise<{ matchedCount: number }> {
  const supplierNormalized = params.supplierName.trim().toLowerCase();
  if (!supplierNormalized) return { matchedCount: 0 };

  const result = await db
    .update(serviceOrderOutsourcedCost)
    .set({
      actualCostCents: params.amountCents,
      payableLinkId: params.payableLinkId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(serviceOrderOutsourcedCost.organizationId, params.organizationId),
        isNull(serviceOrderOutsourcedCost.payableLinkId),
        isNull(serviceOrderOutsourcedCost.voidedAt),
        sql`lower(trim(${serviceOrderOutsourcedCost.supplierName})) = ${supplierNormalized}`,
      ),
    )
    .returning();

  return { matchedCount: result.length };
}
