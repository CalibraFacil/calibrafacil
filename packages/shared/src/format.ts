/**
 * The one formatting layer for dates, times, money and numbers (pt-BR).
 *
 * Every screen, email, PDF and notification formats through these functions, so
 * a value reads the same everywhere and never depends on the zone of the
 * process that renders it (a browser anywhere, a server on UTC):
 *
 * - {@link formatInstant}: a MOMENT (created, sent, approved, last used). Shown
 *   in the laboratory's zone, America/Sao_Paulo, named explicitly.
 * - {@link formatCalendarDate}: a DAY a value names (a due date, an
 *   accreditation bound, a calibration date). Postgres `date` columns arrive at
 *   UTC midnight, which read in Sao Paulo is the evening before; the day is
 *   chosen by `getDateOnlyDay` (calendar-date.ts): exact UTC midnight names its
 *   UTC day, any other instant names its Sao Paulo day.
 * - {@link formatMoneyBRL} / {@link formatMoney}: integer cents to currency.
 * - {@link formatNumber} / {@link formatPercent}: decimals, grouping, percent.
 *
 * This module (and its tests) is the only place that may construct
 * `Intl.DateTimeFormat` / `Intl.NumberFormat` or call `toLocale*String`; the
 * `calibra/no-raw-locale-formatting` lint rule enforces that. Formatters are
 * built once per shape and cached at module level.
 */
import { LAB_TIME_ZONE, getDateOnlyDay } from "./calendar-date.js";

const LOCALE = "pt-BR";

/** Rendered for an absent or unreadable value. */
const EMPTY = "—";

type DateInput = Date | string | number | null | undefined;

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const DATE_FIELDS = {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
} satisfies Intl.DateTimeFormatOptions;

const TIME_FIELDS = {
  hour: "2-digit",
  minute: "2-digit",
} satisfies Intl.DateTimeFormatOptions;

/**
 * Styles that read a day (no time of day): valid for instants and for
 * calendar dates.
 *
 * - `date`: "02/10/2026"
 * - `date-medium`: "02 de out. de 2026"
 * - `date-medium-natural`: "2 de out. de 2026" (no zero-padded day)
 * - `date-long`: "02 de outubro de 2026"
 * - `day-month`: "02 de out."
 * - `weekday-day-month`: "sex., 02 de out."
 * - `month-year`: "outubro de 2026"
 * - `month-year-short`: "out. de 26"
 * - `month`: "out."
 */
export type CalendarDateStyle =
  | "date"
  | "date-medium"
  | "date-medium-natural"
  | "date-long"
  | "day-month"
  | "weekday-day-month"
  | "month-year"
  | "month-year-short"
  | "month";

/**
 * Styles for an instant: every {@link CalendarDateStyle} plus the ones that
 * carry a time of day.
 *
 * - `date-time`: "02/10/2026, 14:30"
 * - `date-time-medium`: "02 de out. de 2026, 14:30"
 * - `time`: "14:30"
 */
export type InstantStyle =
  | CalendarDateStyle
  | "date-time"
  | "date-time-medium"
  | "time";

const STYLE_OPTIONS = {
  date: DATE_FIELDS,
  "date-medium": { day: "2-digit", month: "short", year: "numeric" },
  "date-medium-natural": { day: "numeric", month: "short", year: "numeric" },
  "date-long": { day: "2-digit", month: "long", year: "numeric" },
  "day-month": { day: "2-digit", month: "short" },
  "weekday-day-month": { weekday: "short", day: "2-digit", month: "short" },
  "month-year": { month: "long", year: "numeric" },
  "month-year-short": { month: "short", year: "2-digit" },
  month: { month: "short" },
  "date-time": { ...DATE_FIELDS, ...TIME_FIELDS },
  "date-time-medium": {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...TIME_FIELDS,
  },
  time: TIME_FIELDS,
} satisfies Record<InstantStyle, Intl.DateTimeFormatOptions>;

export type FormatOptions = {
  /** Rendered for an absent or unreadable value. Defaults to "—". */
  empty?: string;
};

const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();

function dateTimeFormat(
  style: InstantStyle,
  timeZone: string,
): Intl.DateTimeFormat {
  const key = `${style}|${timeZone}`;
  const cached = dateTimeFormats.get(key);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat(LOCALE, {
    ...STYLE_OPTIONS[style],
    timeZone,
  });
  dateTimeFormats.set(key, created);
  return created;
}

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * A moment, in the laboratory's time zone (America/Sao_Paulo) whatever the zone
 * of the machine that renders it: `formatInstant(x, "date-time")` is
 * "02/10/2026, 14:30". Absent or unreadable values render as `options.empty`
 * ("—" by default).
 */
export function formatInstant(
  value: DateInput,
  style: InstantStyle = "date",
  options: FormatOptions = {},
): string {
  const date = toDate(value);
  if (!date) return options.empty ?? EMPTY;
  return dateTimeFormat(style, LAB_TIME_ZONE).format(date);
}

/**
 * The day a stored calendar-date value names (a due date, an accreditation
 * bound, a calibration date), as text: `formatCalendarDate(x)` is "15/10/2026".
 * The day is `getDateOnlyDay`'s: an exact-UTC-midnight value names its UTC day,
 * any other instant its America/Sao_Paulo day, so it reads the same under any
 * process time zone. Absent or unreadable values render as `options.empty`.
 */
export function formatCalendarDate(
  value: DateInput,
  style: CalendarDateStyle = "date",
  options: FormatOptions = {},
): string {
  const date = toDate(value);
  if (!date) return options.empty ?? EMPTY;
  const { year, month, day } = getDateOnlyDay(date);
  // Noon UTC of the named day, read in UTC: no zone can move it to another day.
  return dateTimeFormat(style, "UTC").format(
    new Date(Date.UTC(year, month - 1, day, 12)),
  );
}

/**
 * A date a date PICKER hands over: a `Date` at local midnight of the day the
 * user chose, built from local fields (`new Date(y, m, d)`). Its day is the
 * local one, whatever the lab zone is.
 */
export function formatLocalDay(
  value: Date | null | undefined,
  style: CalendarDateStyle = "date",
  options: FormatOptions = {},
): string {
  const date = toDate(value);
  if (!date) return options.empty ?? EMPTY;
  return dateTimeFormat(style, "UTC").format(
    new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12)),
  );
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export type NumberOptions = {
  /** Exactly this many fraction digits (sets both min and max). */
  decimals?: number;
  /** At least this many fraction digits (with `maxDecimals`). */
  minDecimals?: number;
  /** At most this many fraction digits. */
  maxDecimals?: number;
  /** Thousands separators. Defaults to true; off for editable input values. */
  grouping?: boolean;
  /** Rendered for an absent or non-finite value. Defaults to "—". */
  empty?: string;
};

type FractionDigits = { min: number | undefined; max: number | undefined };

function fractionDigits(options: NumberOptions): FractionDigits {
  if (options.decimals !== undefined) {
    return { min: options.decimals, max: options.decimals };
  }
  return { min: options.minDecimals, max: options.maxDecimals };
}

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(
  kind: "decimal" | "percent",
  options: NumberOptions,
): Intl.NumberFormat {
  const { min, max } = fractionDigits(options);
  const grouping = options.grouping ?? true;
  const key = `${kind}|${min ?? ""}|${max ?? ""}|${grouping}`;
  const cached = numberFormats.get(key);
  if (cached) return cached;
  const created = new Intl.NumberFormat(LOCALE, {
    style: kind,
    useGrouping: grouping,
    // Intl rejects a minimum above the maximum; a lone `minDecimals` lifts the
    // maximum with it and a lone `maxDecimals` lowers the minimum with it.
    ...(min !== undefined
      ? {
          minimumFractionDigits: min,
          maximumFractionDigits:
            max ?? Math.max(min, kind === "percent" ? 0 : 3),
        }
      : max !== undefined
        ? { minimumFractionDigits: 0, maximumFractionDigits: max }
        : {}),
  });
  numberFormats.set(key, created);
  return created;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * A plain number, pt-BR: `formatNumber(1234.5, { decimals: 2 })` is "1.234,50".
 * Without options, up to three fraction digits ("1.234,568").
 */
export function formatNumber(
  value: number | null | undefined,
  options: NumberOptions = {},
): string {
  if (!isFiniteNumber(value)) return options.empty ?? EMPTY;
  return numberFormat("decimal", options).format(value);
}

/** A FRACTION as a percentage: `formatPercent(0.255, { decimals: 1 })` is "25,5%". */
export function formatPercent(
  fraction: number | null | undefined,
  options: NumberOptions = {},
): string {
  if (!isFiniteNumber(fraction)) return options.empty ?? EMPTY;
  return numberFormat("percent", options).format(fraction);
}

/**
 * A value already in percent points as a percentage:
 * `formatPercentPoints(12.34, { maxDecimals: 1 })` is "12,3%".
 */
export function formatPercentPoints(
  points: number | null | undefined,
  options: NumberOptions = {},
): string {
  if (!isFiniteNumber(points)) return options.empty ?? EMPTY;
  return `${numberFormat("decimal", options).format(points)}%`;
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

const currencyFormats = new Map<string, Intl.NumberFormat>();

function currencyFormat(currency: string): Intl.NumberFormat {
  const cached = currencyFormats.get(currency);
  if (cached) return cached;
  const created = new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
  });
  currencyFormats.set(currency, created);
  return created;
}

/** Integer cents in `currency` as pt-BR currency text: "R$ 1.234,56". */
export function formatMoney(cents: number, currency = "BRL"): string {
  return currencyFormat(currency).format(cents / 100);
}

/**
 * Integer cents as Brazilian reais: `formatMoneyBRL(123456)` is "R$ 1.234,56",
 * a negative amount is "-R$ 1,00", absent is "R$ 0,00" (override with
 * `options.empty`).
 */
export function formatMoneyBRL(
  cents: number | null | undefined,
  options: FormatOptions = {},
): string {
  if (options.empty !== undefined && !isFiniteNumber(cents)) {
    return options.empty;
  }
  return formatMoney(isFiniteNumber(cents) ? cents : 0, "BRL");
}

/** "1 ativo" / "3 ativos". */
export function pluralize(
  count: number,
  singular: string,
  plural: string,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
