import { formatCalendarDate } from '@calibra-facil/shared/format'

import { dateOnlyToInputValue } from '@/lib/date-only'

/**
 * A standard's calibration and expiry dates are typed into date fields and
 * stored at UTC midnight (the recall window's bounds too), which read as an
 * instant in Brazil is the evening before. They show on the day they name;
 * a real moment (a default recall window ending now) shows on the laboratory
 * day it happened.
 */
export function formatStandardDate(
  value: string | Date | null | undefined,
): string {
  return formatCalendarDate(value)
}

/** The same day as a `<input type="date">` value (the recall window's fields). */
export function standardDateInputValue(
  value: string | Date | null | undefined,
): string {
  return dateOnlyToInputValue(value)
}
