import { differenceInCalendarDays } from "date-fns";

import type { SignalTone } from "@/components/instrument-panel";

/**
 * Single source of truth for an instrument's calibration status.
 *
 * The portal's most important question — "am I compliant right now?" — comes down
 * to comparing an asset's `nextCalibrationDate` against today. Every surface
 * (dashboard, equipment list, asset detail, nav badge) must answer it the same
 * way, so the logic lives here and nowhere else.
 */

/**
 * The pill vocabulary. Status badges (StatusPill, tables, rows, heroes) speak
 * `StatusTone`; the tile/panel layer (SignalTile, Panel) speaks `SignalTone`.
 * `statusToneToSignal` is the one-way bridge between the two — no status logic
 * is reinvented, every surface still derives from this module + status-labels.
 */
export type StatusTone = "success" | "warning" | "danger" | "info" | "muted";

const SIGNAL_BY_STATUS_TONE: Record<StatusTone, SignalTone> = {
  success: "ok",
  danger: "critical",
  warning: "warning",
  info: "info",
  muted: "neutral",
};

export function statusToneToSignal(tone: StatusTone): SignalTone {
  return SIGNAL_BY_STATUS_TONE[tone];
}

export type CalibrationStatus =
  | "OVERDUE"
  | "DUE_SOON"
  | "SCHEDULED"
  | "UNSCHEDULED";

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
};

const LABEL_BY_STATUS: Record<CalibrationStatus, string> = {
  OVERDUE: "Vencida",
  DUE_SOON: "Vence em breve",
  SCHEDULED: "Em dia",
  UNSCHEDULED: "Sem agenda",
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

  const daysDelta = differenceInCalendarDays(due, now);
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

/** URL-safe filter values used to deep-link the equipment list to a status. */
export const CALIBRATION_FILTERS = [
  "overdue",
  "due_soon",
  "scheduled",
  "unscheduled",
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

export function calibrationFilterToStatus(
  filter: CalibrationFilter,
): CalibrationStatus {
  switch (filter) {
    case "overdue":
      return "OVERDUE";
    case "due_soon":
      return "DUE_SOON";
    case "scheduled":
      return "SCHEDULED";
    case "unscheduled":
      return "UNSCHEDULED";
  }
}
