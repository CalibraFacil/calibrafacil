// #427: frozen accredited-scope (CMC) verdict columns, mirrored from the
// cloud row so the desktop job detail shows the same warnings and — above
// all — suppresses the accreditation seal for override-downgraded
// certificates exactly like every cloud render site.
export const migration0016CalibrationJobScopeCompliance = {
  id: 16,
  name: "calibration_job_scope_compliance",
  sql: `
ALTER TABLE calibration_jobs ADD COLUMN scope_compliance_status TEXT;
ALTER TABLE calibration_jobs ADD COLUMN scope_compliance_findings_json TEXT;
ALTER TABLE calibration_jobs ADD COLUMN scope_override_justification TEXT;
`,
};
