import { formatCalendarDate } from '@calibra-facil/shared/format'

import { dateInputToNoonIso, dateOnlyToInputValue } from '@/lib/date-only'

/**
 * The visit's scheduled day is picked in a `<input type="date">` ("2026-08-10")
 * but the API stores an instant. Sending the bare date makes the server parse
 * it as UTC midnight, which every screen then shows as the evening before in
 * Brazil, so the typed day travels as local noon.
 */

/**
 * The scheduled day as the date field's value. Visits saved before the typed
 * day travelled as local noon are stored at UTC midnight and name that day.
 */
export function visitDateInputValue(scheduledAt: string | null): string {
  return dateOnlyToInputValue(scheduledAt)
}

/** The scheduled day for a visit row: "10 de ago. de 2026". */
export function formatVisitDay(scheduledAt: string | null | undefined): string {
  return formatCalendarDate(scheduledAt, 'date-medium', {
    empty: 'A confirmar',
  })
}

/** Empty or invalid input leaves the schedule untouched (`null`). */
export function visitScheduledAtPayload(dateInput: string): string | null {
  return dateInputToNoonIso(dateInput)
}

export function buildVisitRescheduleInput(dateInput: string) {
  return { scheduledAt: visitScheduledAtPayload(dateInput) }
}

export function buildVisitConfirmInput(
  dateInput: string,
  technicianId: string,
) {
  return {
    scheduledAt: visitScheduledAtPayload(dateInput),
    technicianId: technicianId || null,
  }
}

export function buildVisitAcceptRescheduleInput(dateInput: string) {
  const scheduledAt = visitScheduledAtPayload(dateInput)
  return scheduledAt ? { scheduledAt } : null
}
