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
 * That rule is `getDateOnlyDay` below; `formatCalendarDate` (./format) renders
 * the day it names, and @calibra-facil/documents re-exports these helpers under
 * their historical names (`formatDateOnlyKey`, `formatLabDayKey`).
 */

/**
 * The time zone the laboratory reads its calendar in. Moments (when an order
 * was opened, a calibration performed, a document issued) are shown in it, and
 * the process's own zone (UTC on a server, anything in a browser) never decides.
 */
export const LAB_TIME_ZONE = "America/Sao_Paulo";

const LAB_DAY_PARTS = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZone: LAB_TIME_ZONE,
});

const MS_PER_DAY = 86_400_000;

function dayKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The laboratory's wall clock at an instant, as numbers (hours 0-23): the one
 * place a moment is split into the laboratory's day and time of day.
 */
export function getLabClock(date: Date) {
  const parts = Object.fromEntries(
    LAB_DAY_PARTS.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/**
 * The laboratory's calendar day of a moment, as numbers. For anything that is
 * named after the day (a certificate number's year/month/day, the sequence it
 * resets on) and so must not depend on the server's zone.
 */
export function getLabCalendarDay(value: Date): {
  year: number;
  month: number;
  day: number;
} {
  const { year, month, day } = getLabClock(value);
  return { year, month, day };
}

/** The laboratory's (America/Sao_Paulo) calendar day of an instant: "2026-10-15". */
export function labCalendarDayKey(instant: Date): string {
  const { year, month, day } = getLabCalendarDay(instant);
  return dayKey(year, month, day);
}

/** The instant the laboratory's calendar month of `date` began. */
export function startOfLabMonth(date: Date): Date {
  const { year, month } = getLabClock(date);
  const wallClockAsUtc = Date.UTC(year, month - 1, 1);
  // The zone's offset on that day, found by reading the guess back in the zone.
  const read = getLabClock(new Date(wallClockAsUtc));
  const readAsUtc = Date.UTC(
    read.year,
    read.month - 1,
    read.day,
    read.hour,
    read.minute,
    read.second,
  );
  return new Date(wallClockAsUtc - (readAsUtc - wallClockAsUtc));
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
 * The calendar day a stored calendar-date value names, as numbers (a standard's
 * calibration date, a due date, a visit day). These are typed into date fields
 * and stored at exactly UTC midnight, which read in Sao Paulo is the evening
 * before, so an exact-UTC-midnight value names its UTC day. Any other instant
 * (a value stored at local noon, or a real moment) names its laboratory day.
 */
export function getDateOnlyDay(value: Date): {
  year: number;
  month: number;
  day: number;
} {
  if (isUtcMidnight(value)) {
    return {
      year: value.getUTCFullYear(),
      month: value.getUTCMonth() + 1,
      day: value.getUTCDate(),
    };
  }
  return getLabCalendarDay(value);
}

/**
 * The calendar day a stored calendar-date value names, as "2026-10-15": the
 * UTC day for an exact-UTC-midnight value, the laboratory day for any other
 * instant. See {@link getDateOnlyDay}.
 */
export function calendarDateKey(value: Date): string {
  const { year, month, day } = getDateOnlyDay(value);
  return dayKey(year, month, day);
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
export const LAB_TODAY_SQL = `(now() AT TIME ZONE '${LAB_TIME_ZONE}')::date`;

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
 * The calendar date `businessDays` weekdays after the laboratory's day of
 * `start` (Saturdays and Sundays do not count): a turnaround due date.
 */
export function addLabBusinessDays(start: Date, businessDays: number): Date {
  let day = labToday(start);
  let remaining = businessDays;
  while (remaining > 0) {
    day = addCalendarDays(day, 1);
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return day;
}

/**
 * Whole laboratory days from the day an INSTANT fell on (a completion, a
 * sending, a status change) to today's laboratory day: 0 on the same day, 1
 * the day after. For calendar dates (a due date, an issue date) use
 * `-labDaysUntil` instead: it reads them by the day they name.
 */
export function labDaysSince(instant: Date, now: Date = new Date()): number {
  const day = calendarDateFromKey(labCalendarDayKey(instant));
  if (!day) throw new RangeError("Invalid date");
  return calendarDaysBetween(day, labToday(now));
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

// ---------------------------------------------------------------------------
// Date-input helpers (`<input type="date">` / date pickers), shared by the lab
// app and the portal.
// ---------------------------------------------------------------------------

const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Today's laboratory day as a `<input type="date">` value. */
export function todayDateInputValue(now: Date = new Date()): string {
  return labCalendarDayKey(now);
}

/**
 * A typed day ("2026-05-20") as the instant of local noon that day. Noon keeps
 * the day stable when the instant is read back in the browser's zone or in
 * UTC (15:00Z in Sao Paulo), where midnight would slip to the day before.
 * Returns null for anything that is not a real calendar day.
 */
export function dateInputToNoonIso(value: string): string | null {
  const trimmed = value.trim();
  if (!DATE_INPUT_PATTERN.test(trimmed)) return null;
  const date = new Date(`${trimmed}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * The inverse of {@link dateInputToNoonIso}: an instant as the day the user
 * sees for it (the browser's calendar day, which is what the screens render
 * dates with). Empty for a missing or unparseable value.
 */
export function instantToDateInputValue(
  value: string | Date | null | undefined,
): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return dayKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/**
 * Whole calendar days from `today`'s laboratory day to the laboratory day of
 * `instant` (negative when past). Independent of the browser's zone.
 */
export function labDaysBetween(today: Date, instant: Date): number {
  const from = getLabCalendarDay(today);
  const to = getLabCalendarDay(instant);
  return Math.round(
    (Date.UTC(to.year, to.month - 1, to.day) -
      Date.UTC(from.year, from.month - 1, from.day)) /
      MS_PER_DAY,
  );
}

/**
 * A stored calendar-date value (a standard's calibration date, a due date, a
 * visit day: typed in a date field, saved at UTC midnight) as the day it names,
 * for a `<input type="date">`. {@link instantToDateInputValue} would read it in
 * the browser's zone and give the day before.
 */
export function dateOnlyToInputValue(
  value: string | Date | null | undefined,
): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return calendarDateKey(date);
}

/**
 * A stored calendar-date value as the LOCAL date a date picker should show:
 * local midnight of the day it names. `new Date(value)` would be UTC midnight,
 * which a picker in Brazil shows as the day before (and saves back as that
 * day). Undefined for a missing or unreadable value.
 */
export function dateOnlyToLocalDate(
  value: string | Date | null | undefined,
): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const { year, month, day } = getDateOnlyDay(date);
  return new Date(year, month - 1, day);
}

/**
 * Whole calendar days from `today`'s laboratory day to the day a stored
 * calendar-date value names (negative when past): the due-today /
 * expired-yesterday counts.
 */
export function dateOnlyDaysBetween(today: Date, value: Date): number {
  const from = getLabCalendarDay(today);
  const to = getDateOnlyDay(value);
  return Math.round(
    (Date.UTC(to.year, to.month - 1, to.day) -
      Date.UTC(from.year, from.month - 1, from.day)) /
      MS_PER_DAY,
  );
}
