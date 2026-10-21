/**
 * Date-only values ("2026-05-20") name a day on the laboratory's calendar, not
 * a UTC instant. `new Date().toISOString().slice(0, 10)` is the UTC day, so
 * after 21:00 in Brazil "today" becomes tomorrow; `new Date("2026-05-20")` is
 * UTC midnight, the evening before. Go through these helpers instead.
 *
 * The implementation lives in @calibra-facil/shared (one copy for the lab app
 * and the portal); this module keeps the app's `@/lib/date-only` import path.
 */
export {
  dateInputToNoonIso,
  dateOnlyDaysBetween,
  dateOnlyToInputValue,
  dateOnlyToLocalDate,
  instantToDateInputValue,
  labDaysBetween,
  todayDateInputValue,
} from '@calibra-facil/shared/calendar-date'
