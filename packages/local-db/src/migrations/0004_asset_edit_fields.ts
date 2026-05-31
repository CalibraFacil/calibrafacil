export const migration0004AssetEditFields = {
  id: 4,
  name: "asset_edit_fields",
  sql: `
ALTER TABLE assets ADD COLUMN last_calibration_date TEXT;
ALTER TABLE assets ADD COLUMN next_calibration_date TEXT;
ALTER TABLE assets ADD COLUMN comments TEXT;
`,
};
