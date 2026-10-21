/**
 * Whether a reference standard may be used for a calibration performed at a
 * given moment. One definition for every place that checks it: the cloud's job
 * execution/submit, the desktop sync apply, the local server and the offline
 * local database, so the desktop cannot record what the cloud would refuse
 * (nor refuse what it would accept).
 *
 * A standard is valid THROUGH the calendar day its certificate names
 * (`nextCalibrationDate`, a date, not an instant). It is judged on the
 * laboratory's (America/Sao_Paulo) day of `performedAt`: work done at 23:30 on
 * the last valid day is accepted, work done at 00:10 the next day is refused.
 * `performedAt` is when the work was done, never when it was synced or saved.
 */

// The laboratory-day helpers the offline packages (which do not depend on
// @calibra-facil/shared) compare calendar dates with.
export {
  addCalendarDays,
  calendarDateKey,
  isCalendarDatePast,
  labCalendarDayKey,
  labDaysUntil,
  labToday,
} from "@calibra-facil/shared/calendar-date";

import {
  calendarDateFromKey,
  calendarDateKey,
  calendarDaysBetween,
  labCalendarDayKey,
  labToday,
} from "@calibra-facil/shared/calendar-date";

/** A certificate day as a Date; a bare "2026-10-15" is that day, not an instant. */
function readValidityDay(value: Date | string): Date | null {
  const date =
    value instanceof Date
      ? value
      : /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? calendarDateFromKey(value)
        : new Date(value);
  return date === null || Number.isNaN(date.getTime()) ? null : date;
}

export function isStandardValidOn(
  nextCalibrationDate: Date | string,
  performedAt: Date,
): boolean {
  const validThrough = readValidityDay(nextCalibrationDate);
  if (!validThrough || Number.isNaN(performedAt.getTime())) return false;
  // "YYYY-MM-DD" keys order like the days they name.
  return labCalendarDayKey(performedAt) <= calendarDateKey(validThrough);
}

export type StandardValidityAssessment = {
  /** Expired on the day the work was performed: never acceptable. */
  expiredAtPerformed: string[];
  /**
   * Valid on the performed day but expired as of `now`: acceptable only as a
   * justified backdated record, so the submission needs a written reason even
   * when the backdate is within the usual 7 days.
   */
  validOnlyBecauseBackdated: string[];
};

/**
 * Judge every standard of a calibration at the performed day, and tell which
 * of them are valid ONLY because the work is dated in the past.
 */
export function assessStandardValidity(
  standards: ReadonlyArray<{
    name: string;
    nextCalibrationDate: Date | string;
  }>,
  performedAt: Date,
  now: Date = new Date(),
): StandardValidityAssessment {
  const expiredAtPerformed: string[] = [];
  const validOnlyBecauseBackdated: string[] = [];
  for (const standard of standards) {
    if (!isStandardValidOn(standard.nextCalibrationDate, performedAt)) {
      expiredAtPerformed.push(standard.name);
    } else if (!isStandardValidOn(standard.nextCalibrationDate, now)) {
      validOnlyBecauseBackdated.push(standard.name);
    }
  }
  return { expiredAtPerformed, validOnlyBecauseBackdated };
}

/**
 * Whole laboratory days from today (the day of `now`) to the last valid day of
 * a standard: 0 on that day, negative once it has expired. Null when the date
 * is unreadable.
 */
export function standardDaysUntilExpiry(
  nextCalibrationDate: Date | string,
  now: Date = new Date(),
): number | null {
  const validThrough = readValidityDay(nextCalibrationDate);
  if (!validThrough) return null;
  return calendarDaysBetween(labToday(now), validThrough);
}
