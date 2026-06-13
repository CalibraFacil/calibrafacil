import { format } from "date-fns";

import type { CalendarDueAsset } from "./queries";

/**
 * Bucket key for a calendar day in the user's local timezone — the same
 * timezone `formatDate` renders with everywhere else in the portal, so an
 * instrument never shows one date in the table and another on the calendar.
 */
export function dayKey(value: Date): string {
  return format(value, "yyyy-MM-dd");
}

/** Group due instruments by local calendar day. */
export function groupDuesByDay(
  dues: Array<CalendarDueAsset>,
): Map<string, Array<CalendarDueAsset>> {
  const byDay = new Map<string, Array<CalendarDueAsset>>();
  for (const due of dues) {
    const date = new Date(due.nextCalibrationDate);
    if (Number.isNaN(date.getTime())) continue;
    const key = dayKey(date);
    const bucket = byDay.get(key);
    if (bucket) {
      bucket.push(due);
    } else {
      byDay.set(key, [due]);
    }
  }
  return byDay;
}

/** "YYYY-MM" → first day of that month (local), or null when malformed. */
export function parseMonthParam(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null;
  const [year, month] = value.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

export function toMonthParam(value: Date): string {
  return format(value, "yyyy-MM");
}
