// The date helpers documents (and the API's certificate numbering) use live in
// @calibra-facil/shared: this module only keeps the names this package has
// always exported. Documents are rendered on the server, whose clock runs in
// UTC, so every date goes through the shared functions, which name the
// laboratory's time zone instead of the process default.
export {
  LAB_TIME_ZONE,
  getDateOnlyDay,
  getLabCalendarDay,
  startOfLabMonth,
  calendarDateKey as formatDateOnlyKey,
  labCalendarDayKey as formatLabDayKey,
} from "@calibra-facil/shared/calendar-date";
export {
  formatCalendarDate,
  formatInstant,
} from "@calibra-facil/shared/format";
