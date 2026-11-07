/**
 * The vocabulary of the calibration record a job freezes besides its data: where
 * the work was done and which phases (before/after adjustment) each method block
 * covers. Declared once here; the schemas, the database column types, the
 * execution core, the desktop and both frontends all import it.
 */

export const CALIBRATION_PHASE_MODES = [
  "before_and_after",
  "before_only",
  "after_only",
  "not_performed",
] as const;

export type CalibrationPhaseMode = (typeof CALIBRATION_PHASE_MODES)[number];

export function isCalibrationPhaseMode(
  mode: unknown,
): mode is CalibrationPhaseMode {
  return CALIBRATION_PHASE_MODES.some((candidate) => candidate === mode);
}

export const CALIBRATION_LOCATION_TYPES = [
  "customer_site",
  "lab",
  "other",
] as const;

export type CalibrationLocationType =
  (typeof CALIBRATION_LOCATION_TYPES)[number];

/** What a caller sends for the location of a calibration (execute/submit body). */
export type CalibrationLocationInput = {
  type: CalibrationLocationType;
  addressText: string;
  notes?: string | null;
};

/** What a caller sends for the phases of a calibration (execute/submit body). */
export type CalibrationPhaseInput = {
  blocks: Record<
    string,
    {
      mode: CalibrationPhaseMode;
      reason?: string | null;
    }
  >;
};

/** The frozen location of a calibration (`calibration_job.calibration_location_snapshot`). */
export type CalibrationLocationSnapshot = {
  type: CalibrationLocationType;
  addressText: string;
  notes?: string | null;
  recordedAt: string;
  recordedBy: string;
};

/** The frozen phases of a calibration (`calibration_job.calibration_phase_snapshot`). */
export type CalibrationPhaseSnapshot = CalibrationPhaseInput & {
  recordedAt: string;
  recordedBy: string;
};
