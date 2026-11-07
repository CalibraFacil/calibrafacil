import { SignalTone } from "@calibra-facil/shared/status-vocabulary";
import { dateOnlyDaysBetween } from "@calibra-facil/shared/calendar-date";

/**
 * Single source of truth for an instrument's calibration status.
 *
 * The portal's most important question — "am I compliant right now?" — comes down
 * to comparing an asset's `nextCalibrationDate` against today. Every surface
 * (dashboard, equipment list, asset detail, nav badge) must answer it the same
 * way, so the logic lives here and nowhere else.
 */

export type CalibrationStatus =
  | "OVERDUE"
  | "DUE_SOON"
  | "SCHEDULED"
  | "UNSCHEDULED"
  | "IN_LAB";

/** An instrument counts as "due soon" within this many days of its due date. */
export const DUE_SOON_DAYS = 30;

export type CalibrationStatusInfo = {
  status: CalibrationStatus;
  tone: SignalTone;
  /** Short label for pills/badges, e.g. "Vencida". */
  label: string;
  /** Whole calendar days until due; negative when overdue, null when unscheduled. */
  daysDelta: number | null;
  /** Human sentence, e.g. "Vencida há 3 dias", "Vence em 12 dias", "Vence hoje". */
  description: string;
};

const TONE_BY_STATUS: Record<CalibrationStatus, SignalTone> = {
  OVERDUE: "critical",
  DUE_SOON: "warning",
  SCHEDULED: "ok",
  UNSCHEDULED: "neutral",
  IN_LAB: "info",
};

const LABEL_BY_STATUS: Record<CalibrationStatus, string> = {
  OVERDUE: "Vencida",
  DUE_SOON: "Vence em breve",
  SCHEDULED: "Em dia",
  UNSCHEDULED: "Sem agenda",
  IN_LAB: "No laboratório",
};

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pluralizeDays(count: number): string {
  return count === 1 ? "1 dia" : `${count} dias`;
}

function describe(status: CalibrationStatus, daysDelta: number | null): string {
  switch (status) {
    case "IN_LAB":
      return "Em atendimento no laboratório";
    case "UNSCHEDULED":
      return "Sem data de calibração";
    case "OVERDUE":
      return `Vencida há ${pluralizeDays(Math.abs(daysDelta ?? 0))}`;
    case "DUE_SOON":
      return daysDelta === 0
        ? "Vence hoje"
        : `Vence em ${pluralizeDays(daysDelta ?? 0)}`;
    case "SCHEDULED":
      return `Vence em ${pluralizeDays(daysDelta ?? 0)}`;
  }
}

export function getCalibrationStatus(
  nextCalibrationDate: string | Date | null | undefined,
  now: Date = new Date(),
): CalibrationStatusInfo {
  const due = toDate(nextCalibrationDate);

  if (!due) {
    return {
      status: "UNSCHEDULED",
      tone: TONE_BY_STATUS.UNSCHEDULED,
      label: LABEL_BY_STATUS.UNSCHEDULED,
      daysDelta: null,
      description: describe("UNSCHEDULED", null),
    };
  }

  // The due date is a calendar day (a Postgres date, sent as UTC midnight):
  // count laboratory days to the day it names, not browser-zone days to the
  // instant, which read it as the evening before in Brazil.
  const daysDelta = dateOnlyDaysBetween(now, due);
  const status: CalibrationStatus =
    daysDelta < 0
      ? "OVERDUE"
      : daysDelta <= DUE_SOON_DAYS
        ? "DUE_SOON"
        : "SCHEDULED";

  return {
    status,
    tone: TONE_BY_STATUS[status],
    label: LABEL_BY_STATUS[status],
    daysDelta,
    description: describe(status, daysDelta),
  };
}

/**
 * Status of an instrument as a whole: an instrument currently at the lab
 * (open calibration job or open service order) reads "No laboratório",
 * taking precedence over the date-derived status — it may well be overdue,
 * but it is already being handled.
 */
export function getInstrumentStatus(
  instrument: {
    nextCalibrationDate: string | Date | null | undefined;
    inLab?: boolean;
  },
  now: Date = new Date(),
): CalibrationStatusInfo {
  if (instrument.inLab) {
    return {
      status: "IN_LAB",
      tone: TONE_BY_STATUS.IN_LAB,
      label: LABEL_BY_STATUS.IN_LAB,
      daysDelta: null,
      description: describe("IN_LAB", null),
    };
  }
  return getCalibrationStatus(instrument.nextCalibrationDate, now);
}

/** URL-safe filter values used to deep-link the equipment list to a status. */
const CALIBRATION_FILTERS = [
  "overdue",
  "due_soon",
  "scheduled",
  "unscheduled",
  "in_lab",
] as const;

export type CalibrationFilter = (typeof CALIBRATION_FILTERS)[number];

export function isCalibrationFilter(
  value: unknown,
): value is CalibrationFilter {
  return (
    typeof value === "string" &&
    CALIBRATION_FILTERS.some((filter) => filter === value)
  );
}
