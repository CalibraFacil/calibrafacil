import type { CommercialAgreementStatus } from "@calibra-facil/shared";

export interface ContractIntelligenceInput {
  id: number;
  title: string;
  status: CommercialAgreementStatus;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  /**
   * Monthly recurring revenue from the agreement's priced service terms.
   * `null` when the contract is not yet priced — counted in the
   * `unpricedContractCount` summary metric.
   */
  monthlyRecurringCents: number | null;
  /** Number of completed jobs against this contract this period. */
  jobsCompletedThisPeriod: number;
  /** Quota for this contract over the period; null when unbounded. */
  jobsQuotaThisPeriod: number | null;
  /**
   * Aggregate outsourced cost (cents) for jobs delivered against this
   * contract. Used to compute profitability vs. monthly recurring.
   */
  outsourcedCostThisPeriodCents: number;
}

export type ContractRenewalRisk = "LOW" | "MEDIUM" | "HIGH" | "EXPIRED";

export interface ContractIntelligenceRow {
  id: number;
  title: string;
  status: CommercialAgreementStatus;
  utilization: {
    completed: number;
    quota: number | null;
    percent: number | null;
  };
  renewalRisk: ContractRenewalRisk;
  daysUntilExpiry: number | null;
  profitability: {
    revenueCents: number;
    outsourcedCostCents: number;
    marginCents: number;
    marginPercent: number | null;
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function classifyRenewalRisk(
  effectiveTo: Date | null,
  now: Date,
): { risk: ContractRenewalRisk; daysUntilExpiry: number | null } {
  if (!effectiveTo) return { risk: "LOW", daysUntilExpiry: null };
  const days = Math.ceil(
    (effectiveTo.getTime() - now.getTime()) / DAY_MS,
  );
  if (days < 0) return { risk: "EXPIRED", daysUntilExpiry: days };
  if (days <= 30) return { risk: "HIGH", daysUntilExpiry: days };
  if (days <= 90) return { risk: "MEDIUM", daysUntilExpiry: days };
  return { risk: "LOW", daysUntilExpiry: days };
}

export function summarizeContractIntelligence(
  inputs: ReadonlyArray<ContractIntelligenceInput>,
  now: Date = new Date(),
): ContractIntelligenceRow[] {
  return inputs.map((row) => {
    const { risk, daysUntilExpiry } = classifyRenewalRisk(
      row.effectiveTo,
      now,
    );

    const revenueCents = row.monthlyRecurringCents ?? 0;
    const marginCents = revenueCents - row.outsourcedCostThisPeriodCents;
    const marginPercent =
      revenueCents > 0
        ? Math.round((marginCents / revenueCents) * 10_000) / 100
        : null;

    const percent =
      row.jobsQuotaThisPeriod && row.jobsQuotaThisPeriod > 0
        ? Math.round(
            (row.jobsCompletedThisPeriod / row.jobsQuotaThisPeriod) * 10_000,
          ) / 100
        : null;

    return {
      id: row.id,
      title: row.title,
      status: row.status,
      utilization: {
        completed: row.jobsCompletedThisPeriod,
        quota: row.jobsQuotaThisPeriod,
        percent,
      },
      renewalRisk: risk,
      daysUntilExpiry,
      profitability: {
        revenueCents,
        outsourcedCostCents: row.outsourcedCostThisPeriodCents,
        marginCents,
        marginPercent,
      },
    };
  });
}
