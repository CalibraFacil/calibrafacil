// Documents are rendered on the server, whose clock runs in UTC in production,
// so every date here names its time zone instead of using the process default.

/**
 * The time zone a laboratory reads its documents in. Moments (when an order
 * was opened, a calibration performed, a document issued) are shown in it,
 * as the certificate layout already does.
 */
export const LAB_TIME_ZONE = "America/Sao_Paulo";

const DATE = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: LAB_TIME_ZONE,
});

const DATE_TIME = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: LAB_TIME_ZONE,
});

// Calendar dates typed into a date field (a standard's calibration date) are
// stored at UTC midnight; read in any other zone they move a day back.
const CALENDAR_DATE = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

type DateInput = Date | string | null | undefined;

function toDate(value: DateInput): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The day a moment fell on in the laboratory: "02/10/2026". */
export function formatLabDate(value: DateInput, empty = "—"): string {
  const date = toDate(value);
  return date ? DATE.format(date) : empty;
}

/** A moment in the laboratory's time: "02/10/2026, 14:30". */
export function formatLabDateTime(value: DateInput, empty = "—"): string {
  const date = toDate(value);
  return date ? DATE_TIME.format(date) : empty;
}

/** A calendar date stored at UTC midnight: "15/10/2026". */
export function formatCalendarDate(value: DateInput, empty = "—"): string {
  const date = toDate(value);
  return date ? CALENDAR_DATE.format(date) : empty;
}

const DAY_PARTS = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZone: LAB_TIME_ZONE,
});

function labParts(date: Date) {
  const parts = Object.fromEntries(
    DAY_PARTS.formatToParts(date).map((part) => [part.type, part.value]),
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
  const { year, month, day } = labParts(value);
  return { year, month, day };
}

/** The day a moment fell on in the laboratory, as "2026-10-02". */
export function formatLabDayKey(value: Date): string {
  const { year, month, day } = getLabCalendarDay(value);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The instant the laboratory's calendar month of `date` began. */
export function startOfLabMonth(date: Date): Date {
  const { year, month } = labParts(date);
  const wallClockAsUtc = Date.UTC(year, month - 1, 1);
  // The zone's offset on that day, found by reading the guess back in the zone.
  const read = labParts(new Date(wallClockAsUtc));
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
