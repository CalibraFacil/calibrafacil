// ISO/IEC 17025 §7.8.2.1(n): additions to, deviations from, or exclusions from
// the method as executed. Mirrors cloud migration 0106 so a technician working
// offline can record it and the field survives the round trip — a regulated
// certificate field must not be cloud-only, or desktop-executed calibrations
// silently cannot comply.
export const migration0018CalibrationJobMethodDeviations = {
  id: 18,
  name: "calibration_job_method_deviations",
  sql: `
ALTER TABLE calibration_jobs ADD COLUMN method_deviations TEXT;
`,
};
