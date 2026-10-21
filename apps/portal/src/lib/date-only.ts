/**
 * Date-only values ("2026-05-20") name a day on the user's calendar, not a UTC
 * instant. `toISOString().slice(0, 10)` is the UTC day (tomorrow after 21:00
 * in Brazil) and `new Date("2026-05-20")` is UTC midnight (the evening
 * before), so every date input goes through these instead.
 */

import { getDateOnlyDay, getLabCalendarDay } from "@calibra-facil/documents";

const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** An instant as the calendar day the user sees for it (their local day). */
export function instantToDateInputValue(
  value: string | Date | null | undefined,
): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * A typed day as the instant of local noon that day, which stays on that day
 * when read back locally or in UTC. Null for anything but a real calendar day.
 */
export function dateInputToNoonIso(value: string): string | null {
  const trimmed = value.trim();
  if (!DATE_INPUT_PATTERN.test(trimmed)) return null;
  const date = new Date(`${trimmed}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Whole calendar days from `today`'s laboratory day to the day a stored
 * date-only value (a due day saved at UTC midnight) names; negative when past.
 */
export function dateOnlyDaysBetween(today: Date, value: Date): number {
  const from = getLabCalendarDay(today);
  const to = getDateOnlyDay(value);
  return Math.round(
    (Date.UTC(to.year, to.month - 1, to.day) -
      Date.UTC(from.year, from.month - 1, from.day)) /
      86_400_000,
  );
}
