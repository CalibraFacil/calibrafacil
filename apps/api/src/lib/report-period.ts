import { startOfLabMonth } from "@calibra-facil/documents";

export type ReportPeriod = "7d" | "30d" | "90d" | "month";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The window a report covers, ending now. "month" begins at midnight on the
 * 1st in the laboratory's time zone; the server clock runs in UTC, so reading
 * the month there would start it three hours into the previous evening.
 */
export function resolvePeriodRange(period: ReportPeriod, now = new Date()) {
  if (period === "month") {
    return { period, startDate: startOfLabMonth(now), endDate: now };
  }

  const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
  return {
    period,
    startDate: new Date(now.getTime() - days * DAY_MS),
    endDate: now,
  };
}
