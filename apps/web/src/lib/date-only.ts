import {
  formatDateOnlyKey,
  formatLabDayKey,
  getDateOnlyDay,
  getLabCalendarDay,
} from '@calibra-facil/documents'

/**
 * Date-only values ("2026-05-20") name a day on the laboratory's calendar, not
 * a UTC instant. `new Date().toISOString().slice(0, 10)` is the UTC day, so
 * after 21:00 in Brazil "today" becomes tomorrow; `new Date("2026-05-20")` is
 * UTC midnight, the evening before. Go through these helpers instead.
 */

const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** Today's laboratory day as a `<input type="date">` value. */
export function todayDateInputValue(now: Date = new Date()): string {
  return formatLabDayKey(now)
}

/**
 * A typed day ("2026-05-20") as the instant of local noon that day. Noon keeps
 * the day stable when the instant is read back in the browser's zone or in
 * UTC (15:00Z in Sao Paulo), where midnight would slip to the day before.
 * Returns null for anything that is not a real calendar day.
 */
export function dateInputToNoonIso(value: string): string | null {
  const trimmed = value.trim()
  if (!DATE_INPUT_PATTERN.test(trimmed)) return null
  const date = new Date(`${trimmed}T12:00:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * The inverse of {@link dateInputToNoonIso}: an instant as the day the user
 * sees for it (the browser's calendar day, which is what the screens render
 * dates with). Empty for a missing or unparseable value.
 */
export function instantToDateInputValue(
  value: string | Date | null | undefined,
): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Whole calendar days from `today`'s laboratory day to the laboratory day of
 * `instant` (negative when past). Independent of the browser's zone.
 */
export function labDaysBetween(today: Date, instant: Date): number {
  const from = getLabCalendarDay(today)
  const to = getLabCalendarDay(instant)
  return Math.round(
    (Date.UTC(to.year, to.month - 1, to.day) -
      Date.UTC(from.year, from.month - 1, from.day)) /
      86_400_000,
  )
}

/**
 * A stored date-only value (a standard's calibration date, a due date, a visit
 * day: typed in a date field, saved at UTC midnight) as the day it names, for a
 * `<input type="date">`. {@link instantToDateInputValue} would read it in the
 * browser's zone and give the day before.
 */
export function dateOnlyToInputValue(
  value: string | Date | null | undefined,
): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return formatDateOnlyKey(date)
}

/**
 * Whole calendar days from `today`'s laboratory day to the day a stored
 * date-only value names (negative when past): the due-today / expired-yesterday
 * counts.
 */
export function dateOnlyDaysBetween(today: Date, value: Date): number {
  const from = getLabCalendarDay(today)
  const to = getDateOnlyDay(value)
  return Math.round(
    (Date.UTC(to.year, to.month - 1, to.day) -
      Date.UTC(from.year, from.month - 1, from.day)) /
      86_400_000,
  )
}
