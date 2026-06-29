// Legal-metrology offline parity (deferred item #5 of #423). Mirrors the cloud
// Postgres asset columns (packages/db migrations 0066 regime + 0067 installed_at)
// into the offline SQLite store. Additive + forward-only; the migration runner
// (runLocalMigrations) records applied ids so re-running is idempotent — same
// shape as 0004 (asset_edit_fields) and 0009 (subject_to_legal_metrology).
//
// SQLite storage choices (match the existing offline asset columns):
//  - metrology_regime              TEXT NOT NULL DEFAULT 'INDUSTRIAL' (cloud default)
//  - regulated_interval            TEXT (JSON string, like specifications_json)
//  - next_legal_verification_date  TEXT (ISO, like next_calibration_date)
//  - installed_at                  TEXT (ISO)
export const migration0011AssetLegalMetrologyRegime = {
  id: 11,
  name: "asset_legal_metrology_regime",
  sql: `
ALTER TABLE assets ADD COLUMN metrology_regime TEXT NOT NULL DEFAULT 'INDUSTRIAL';
ALTER TABLE assets ADD COLUMN regulated_interval TEXT;
ALTER TABLE assets ADD COLUMN next_legal_verification_date TEXT;
ALTER TABLE assets ADD COLUMN installed_at TEXT;
`,
};
