import type { CommercialAgreementStatus } from "@calibra-facil/shared";

export interface RecurringRevenueAgreementInput {
  status: CommercialAgreementStatus;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  /**
   * Pre-aggregated monthly recurring amount derived upstream (sum of
   * commercialAgreementServiceTerm prices × expected monthly frequency).
   * Null when the lab hasn't priced the agreement yet; counted in
   * `activeWithoutPricingCount` instead of in `monthlyCents`.
   */
  monthlyRecurringCents: number | null;
}

export interface RecurringRevenueSummary {
  activeCount: number;
  activeWithoutPricingCount: number;
  monthlyCents: number;
  annualCents: number;
  expiringIn30DaysCount: number;
  expiringIn90DaysCount: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Pure recurring-revenue projection over a list of commercial agreements.
 * Inputs must be pre-filtered to a single organization. The pricing
 * column is intentionally optional: when the lab hasn't priced an
 * agreement, the engine reports it under `activeWithoutPricingCount`
 * instead of fabricating an amount.
 *
 * `now` is injected to keep the function deterministic under test.
 */
export function summarizeRecurringRevenue(
  agreements: ReadonlyArray<RecurringRevenueAgreementInput>,
  now: Date = new Date(),
): RecurringRevenueSummary {
  const summary: RecurringRevenueSummary = {
    activeCount: 0,
    activeWithoutPricingCount: 0,
    monthlyCents: 0,
    annualCents: 0,
    expiringIn30DaysCount: 0,
    expiringIn90DaysCount: 0,
  };

  for (const agreement of agreements) {
    if (agreement.status !== "ACTIVE") continue;
    summary.activeCount += 1;

    if (agreement.monthlyRecurringCents === null) {
      summary.activeWithoutPricingCount += 1;
    } else {
      summary.monthlyCents += agreement.monthlyRecurringCents;
    }

    if (agreement.effectiveTo) {
      const daysUntilExpiry = Math.ceil(
        (agreement.effectiveTo.getTime() - now.getTime()) / MS_PER_DAY,
      );
      if (daysUntilExpiry >= 0 && daysUntilExpiry <= 30) {
        summary.expiringIn30DaysCount += 1;
      }
      if (daysUntilExpiry >= 0 && daysUntilExpiry <= 90) {
        summary.expiringIn90DaysCount += 1;
      }
    }
  }

  summary.annualCents = summary.monthlyCents * 12;
  return summary;
}
