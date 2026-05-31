export const migration0007CalibrationPhaseSnapshot = {
  id: 7,
  name: "calibration_phase_snapshot",
  sql: `
ALTER TABLE calibration_jobs ADD COLUMN calibration_phase_snapshot_json TEXT;
`,
};
