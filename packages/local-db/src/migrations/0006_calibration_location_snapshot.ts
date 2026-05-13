export const migration0006CalibrationLocationSnapshot = {
  id: 6,
  name: "calibration_location_snapshot",
  sql: `
ALTER TABLE calibration_jobs ADD COLUMN calibration_location_snapshot_json TEXT;
`,
};
