export const migration0009AssetSubjectToLegalMetrology = {
  id: 9,
  name: "asset_subject_to_legal_metrology",
  sql: `
ALTER TABLE assets ADD COLUMN subject_to_legal_metrology INTEGER NOT NULL DEFAULT 0;
`,
};
