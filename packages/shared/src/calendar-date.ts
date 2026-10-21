/**
 * Calendar dates: the days a value NAMES (a due date, a standard's next
 * calibration date, an accreditation bound), as opposed to the moments an event
 * happened.
 *
 * The columns that hold them are Postgres `date` columns. In memory a calendar
 * date stays a `Date` at exactly UTC midnight of the day it names, so
 * `.toISOString().slice(0, 10)` is that day in any zone. Values arrive in other
 * shapes (typed as UTC midnight, as local noon ~15:00Z, or generated with a time
 * of day), and ONE rule says which day each names:
 *
 *   an exact-UTC-midnight value names its UTC day; any other instant names its
 *   America/Sao_Paulo day.
 *
 * This is the same rule as `getDateOnlyDay` / `formatDateOnlyKey` in
 * @calibra-facil/documents (which depends on this package and so cannot be
 * imported here); `packages/documents/src/dates.spec.tsx` pins the parity.
 */

const CALENDAR_TIME_ZONE = "America/Sao_Paulo";

const LAB_DAY_PARTS = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: CALENDAR_TIME_ZONE,
});

const MS_PER_DAY = 86_400_000;

function dayKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The laboratory's (America/Sao_Paulo) calendar day of an instant: "2026-10-15". */
export function labCalendarDayKey(instant: Date): string {
  const parts = Object.fromEntries(
    LAB_DAY_PARTS.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return dayKey(Number(parts.year), Number(parts.month), Number(parts.day));
}

function isUtcMidnight(date: Date): boolean {
  return (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  );
}

/**
 * The calendar day a stored calendar-date value names, as "2026-10-15": the
 * UTC day for an exact-UTC-midnight value, the laboratory day for any other
 * instant.
 */
export function calendarDateKey(value: Date): string {
  if (isUtcMidnight(value)) {
    return dayKey(
      value.getUTCFullYear(),
      value.getUTCMonth() + 1,
      value.getUTCDate(),
    );
  }
  return labCalendarDayKey(value);
}

const DAY_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * The in-memory form of a calendar date: UTC midnight of `key`
 * ("2026-10-15" or an ISO string starting with it). Null when `key` does not
 * start with a real calendar day.
 */
export function calendarDateFromKey(key: string): Date | null {
  const match = DAY_KEY_PATTERN.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function calendarDateOf(value: Date): Date {
  const day = calendarDateFromKey(calendarDateKey(value));
  if (!day) throw new RangeError("Invalid date");
  return day;
}

/**
 * Today in the laboratory as a Postgres `date` expression, for raw SQL that
 * compares a calendar-date column with "today": the database clock runs in
 * UTC, so `now()`, `CURRENT_DATE` and `now() at time zone 'utc'` all name
 * tomorrow between 21:00 and 24:00 in Sao Paulo.
 *
 *   where due_date < (now() AT TIME ZONE 'America/Sao_Paulo')::date
 *
 * Add days with plain integers (`<expr> + 30`); subtract two dates for a day
 * count (`due_date - <expr>`).
 */
export const LAB_TODAY_SQL = `(now() AT TIME ZONE '${CALENDAR_TIME_ZONE}')::date`;

/** Today in the laboratory, as a calendar date (UTC midnight of its day). */
export function labToday(now: Date = new Date()): Date {
  const today = calendarDateFromKey(labCalendarDayKey(now));
  if (!today) throw new RangeError("Invalid date");
  return today;
}

/** A calendar date `days` days later (earlier when negative); zone-proof. */
export function addCalendarDays(date: Date, days: number): Date {
  return new Date(calendarDateOf(date).getTime() + days * MS_PER_DAY);
}

/**
 * Whole calendar days from today's laboratory day (the day of `now`) to the day
 * the calendar date `value` names: 0 on the day itself, negative once it is
 * past. The one way to ask "is it overdue / expired / due soon".
 */
export function labDaysUntil(value: Date, now: Date = new Date()): number {
  return calendarDaysBetween(labToday(now), value);
}

/**
 * Whether the day `value` names is before today's laboratory day: a due date
 * or a validity that is over. The day itself is NOT past (a standard valid
 * through D is still valid on D, a bill due on D is not yet overdue on D).
 */
export function isCalendarDatePast(
  value: Date,
  now: Date = new Date(),
): boolean {
  return labDaysUntil(value, now) < 0;
}

/**
 * Whole calendar days from `from`'s day to `to`'s day (negative when `to` is
 * earlier). Both are calendar-date values.
 */
export function calendarDaysBetween(from: Date, to: Date): number {
  return Math.round(
    (calendarDateOf(to).getTime() - calendarDateOf(from).getTime()) /
      MS_PER_DAY,
  );
}
