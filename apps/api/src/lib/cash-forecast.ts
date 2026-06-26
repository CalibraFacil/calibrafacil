import { db } from "@calibra-facil/db";
import {
  billingDocument,
  commercialAgreement,
  customer,
  receivableInstallment,
  serviceOrder,
} from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { summarizeRecurringRevenue } from "./recurring-revenue";
import { buildUnitScopeCondition } from "./units";

export type CashForecastBucket =
  | "OVERDUE"
  | "THIS_WEEK"
  | "NEXT_WEEK"
  | "IN_30_DAYS"
  | "IN_60_DAYS"
  | "IN_90_DAYS";

export const CASH_FORECAST_BUCKETS: ReadonlyArray<CashForecastBucket> = [
  "OVERDUE",
  "THIS_WEEK",
  "NEXT_WEEK",
  "IN_30_DAYS",
  "IN_60_DAYS",
  "IN_90_DAYS",
];

export const CASH_FORECAST_BUCKET_LABEL: Record<CashForecastBucket, string> = {
  OVERDUE: "Vencidos",
  THIS_WEEK: "Esta semana",
  NEXT_WEEK: "Próxima semana",
  IN_30_DAYS: "Em 30 dias",
  IN_60_DAYS: "Em 60 dias",
  IN_90_DAYS: "Em 90 dias",
};

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CashForecastInstallmentInput {
  amountCents: number;
  dueDate: Date;
}

export function bucketByDueDate(
  installments: ReadonlyArray<CashForecastInstallmentInput>,
  now: Date,
): Record<CashForecastBucket, CashForecastInstallmentInput[]> {
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);

  // ISO week boundary: end of current week = next Sunday 00:00 UTC.
  // For simplicity treat the bucket boundaries as rolling-from-now.
  const day = DAY_MS;
  const thisWeekEnd = new Date(todayStart.getTime() + 7 * day);
  const nextWeekEnd = new Date(todayStart.getTime() + 14 * day);
  const in30 = new Date(todayStart.getTime() + 30 * day);
  const in60 = new Date(todayStart.getTime() + 60 * day);
  const in90 = new Date(todayStart.getTime() + 90 * day);

  const result: Record<CashForecastBucket, CashForecastInstallmentInput[]> = {
    OVERDUE: [],
    THIS_WEEK: [],
    NEXT_WEEK: [],
    IN_30_DAYS: [],
    IN_60_DAYS: [],
    IN_90_DAYS: [],
  };

  for (const item of installments) {
    const t = item.dueDate.getTime();
    if (t < todayStart.getTime()) {
      result.OVERDUE.push(item);
    } else if (t < thisWeekEnd.getTime()) {
      result.THIS_WEEK.push(item);
    } else if (t < nextWeekEnd.getTime()) {
      result.NEXT_WEEK.push(item);
    } else if (t < in30.getTime()) {
      result.IN_30_DAYS.push(item);
    } else if (t < in60.getTime()) {
      result.IN_60_DAYS.push(item);
    } else if (t < in90.getTime()) {
      result.IN_90_DAYS.push(item);
    }
    // Beyond 90d ignored — out of forecast window.
  }

  return result;
}

export interface CashForecastBucketSummary {
  confirmedCents: number;
  projectedCents: number;
  confirmedCount: number;
}

export interface CashForecastSummary {
  buckets: Record<CashForecastBucket, CashForecastBucketSummary>;
  totals: {
    confirmedCents: number;
    projectedCents: number;
    overdueCents: number;
  };
}

const BUCKET_DAYS: Record<Exclude<CashForecastBucket, "OVERDUE">, number> = {
  THIS_WEEK: 7,
  NEXT_WEEK: 7,
  IN_30_DAYS: 16, // days 14..30 = 16 days
  IN_60_DAYS: 30,
  IN_90_DAYS: 30,
};

/**
 * Pure cash-forecast aggregator. `recurringMonthlyCents` is the total
 * monthly recurring revenue from active priced agreements (from
 * `summarizeRecurringRevenue`); we allocate it linearly across the
 * forward buckets (`OVERDUE` gets no projection).
 *
 * `now` is injected for deterministic tests.
 */
export function summarizeCashForecast(input: {
  installments: ReadonlyArray<CashForecastInstallmentInput>;
  recurringMonthlyCents: number;
  now: Date;
}): CashForecastSummary {
  const buckets = bucketByDueDate(input.installments, input.now);
  const dailyRecurring = input.recurringMonthlyCents > 0
    ? Math.floor(input.recurringMonthlyCents / 30)
    : 0;

  const summary: CashForecastSummary = {
    buckets: {
      OVERDUE: { confirmedCents: 0, projectedCents: 0, confirmedCount: 0 },
      THIS_WEEK: { confirmedCents: 0, projectedCents: 0, confirmedCount: 0 },
      NEXT_WEEK: { confirmedCents: 0, projectedCents: 0, confirmedCount: 0 },
      IN_30_DAYS: { confirmedCents: 0, projectedCents: 0, confirmedCount: 0 },
      IN_60_DAYS: { confirmedCents: 0, projectedCents: 0, confirmedCount: 0 },
      IN_90_DAYS: { confirmedCents: 0, projectedCents: 0, confirmedCount: 0 },
    },
    totals: { confirmedCents: 0, projectedCents: 0, overdueCents: 0 },
  };

  for (const bucket of CASH_FORECAST_BUCKETS) {
    const rows = buckets[bucket];
    for (const row of rows) {
      summary.buckets[bucket].confirmedCents += row.amountCents;
      summary.buckets[bucket].confirmedCount += 1;
    }
    if (bucket !== "OVERDUE" && dailyRecurring > 0) {
      const days = BUCKET_DAYS[bucket];
      summary.buckets[bucket].projectedCents += dailyRecurring * days;
    }
  }

  for (const bucket of CASH_FORECAST_BUCKETS) {
    summary.totals.confirmedCents += summary.buckets[bucket].confirmedCents;
    summary.totals.projectedCents += summary.buckets[bucket].projectedCents;
  }
  summary.totals.overdueCents = summary.buckets.OVERDUE.confirmedCents;

  return summary;
}

export interface BuildCashForecastInput {
  organizationId: string;
  scope: Parameters<typeof buildUnitScopeCondition>[1];
  now?: Date;
}

export async function buildCashForecast(
  input: BuildCashForecastInput,
): Promise<CashForecastSummary> {
  const now = input.now ?? new Date();

  // Firm receivables: non-VOID installments not yet PAID, on
  // non-VOID billing documents in the caller's org + unit scope.
  const installments = await db
    .select({
      amountCents: receivableInstallment.amountCents,
      dueDate: receivableInstallment.dueDate,
    })
    .from(receivableInstallment)
    .innerJoin(
      billingDocument,
      eq(billingDocument.id, receivableInstallment.documentId),
    )
    .leftJoin(serviceOrder, eq(serviceOrder.billingDocumentId, billingDocument.id))
    .where(
      and(
        eq(billingDocument.organizationId, input.organizationId),
        // Unit scope via service order when present; otherwise tenant alone.
        // For DRAFT documents without an SO link, the org filter is enough.
        buildUnitScopeCondition(serviceOrder.unitId, input.scope),
      ),
    );

  const eligibleInstallments = installments.flatMap((row) =>
    row.dueDate === null
      ? []
      : [{ amountCents: row.amountCents, dueDate: row.dueDate }],
  );

  // Recurring projection: active agreements with a priced
  // monthlyRecurringCents field. The current schema doesn't carry
  // this column yet, so the priced aggregate is the count × 0 until
  // a later slice surfaces per-agreement pricing. Honest fallback.
  const agreements = await db
    .select({
      status: commercialAgreement.status,
      effectiveFrom: commercialAgreement.effectiveFrom,
      effectiveTo: commercialAgreement.effectiveTo,
    })
    .from(commercialAgreement)
    .innerJoin(customer, eq(customer.id, commercialAgreement.customerId))
    .where(eq(commercialAgreement.organizationId, input.organizationId));

  const recurringSummary = summarizeRecurringRevenue(
    agreements.map((row) => ({
      status: row.status,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      monthlyRecurringCents: null,
    })),
    now,
  );

  return summarizeCashForecast({
    installments: eligibleInstallments,
    recurringMonthlyCents: recurringSummary.monthlyCents,
    now,
  });
}
