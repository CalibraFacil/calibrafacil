import {} from "drizzle-orm";

export interface ServiceOrderMarginInput {
  revenueCents: number;
  outsourcedCosts: ReadonlyArray<{
    expectedCostCents: number;
    actualCostCents: number | null;
    voided: boolean;
  }>;
  partsCosts?: ReadonlyArray<{
    quantity: number;
    unitCostCents: number;
  }>;
}

export interface ServiceOrderMargin {
  revenueCents: number;
  expectedCostCents: number;
  actualCostCents: number;
  outsourcedCostCents: number;
  partsCostCents: number;
  marginCents: number;
  marginPercent: number | null;
}

/**
 * Pure margin computation. `outsourcedCostCents` is the best-known
 * outsourced cost (actual when available, otherwise expected), so the
 * margin pill stays meaningful even before Conta Azul reconciles the
 * payable. `partsCosts` are the parts consumed during execution
 * (`serviceOrderExecutionItem` rows with `type = "part"`); each row is
 * rounded per item since `quantity` can be fractional.
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

  let partsCostCents = 0;
  for (const part of input.partsCosts ?? []) {
    partsCostCents += Math.round(part.quantity * part.unitCostCents);
  }

  const marginCents = input.revenueCents - bestKnownCostCents - partsCostCents;
  const marginPercent =
    input.revenueCents > 0
      ? Math.round((marginCents / input.revenueCents) * 10_000) / 100
      : null;

  return {
    revenueCents: input.revenueCents,
    expectedCostCents,
    actualCostCents,
    outsourcedCostCents: bestKnownCostCents,
    partsCostCents,
    marginCents,
    marginPercent,
  };
}
