/**
 * Date-only values ("2026-05-20") name a day on the user's calendar, not a UTC
 * instant. `toISOString().slice(0, 10)` is the UTC day (tomorrow after 21:00
 * in Brazil) and `new Date("2026-05-20")` is UTC midnight (the evening
 * before), so every date input goes through these instead.
 *
 * The implementation lives in @calibra-facil/shared (one copy for the lab app
 * and the portal); this module keeps the app's `@/lib/date-only` import path.
 */
export {
  dateInputToNoonIso,
  dateOnlyDaysBetween,
  instantToDateInputValue,
} from "@calibra-facil/shared/calendar-date";
