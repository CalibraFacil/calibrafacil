export type FiscalEventKind = "issued" | "rejected" | "cancelled";

export interface FiscalEventInput {
  /** ISO date string when the fiscal event happened (issuance / rejection / cancellation). */
  occurredAt: string;
  kind: FiscalEventKind;
}

export interface FiscalTrendBucket {
  /** Year-month key in YYYY-MM format. */
  period: string;
  issued: number;
  rejected: number;
  cancelled: number;
  total: number;
  rejectionRate: number | null;
}

/**
 * Bucket fiscal events by month (UTC). Returns one row per period
 * even if a period only has one event kind. Sorted ascending by
 * period.
 *
 * `rejectionRate` is `rejected / (issued + rejected)` rounded to
 * 2 decimal places (0–100). Returns `null` when the denominator
 * is 0 to avoid surfacing a fake "100% issued" when no events
 * landed.
 */
export function summarizeFiscalTrend(
  events: ReadonlyArray<FiscalEventInput>,
): FiscalTrendBucket[] {
  const buckets = new Map<string, FiscalTrendBucket>();
  for (const event of events) {
    const date = new Date(event.occurredAt);
    if (Number.isNaN(date.getTime())) continue;
    const period = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    let bucket = buckets.get(period);
    if (!bucket) {
      bucket = {
        period,
        issued: 0,
        rejected: 0,
        cancelled: 0,
        total: 0,
        rejectionRate: null,
      };
      buckets.set(period, bucket);
    }
    bucket[event.kind] += 1;
    bucket.total += 1;
  }

  const rows = [...buckets.values()].sort((a, b) =>
    a.period.localeCompare(b.period),
  );
  for (const row of rows) {
    const denominator = row.issued + row.rejected;
    row.rejectionRate =
      denominator > 0
        ? Math.round((row.rejected / denominator) * 10_000) / 100
        : null;
  }
  return rows;
}
