export const migration0010MassCompositionProfiles = {
  id: 10,
  name: "mass_composition_profiles",
  sql: `
CREATE TABLE IF NOT EXISTS mass_composition_profiles (
  id TEXT PRIMARY KEY,
  remote_id INTEGER,
  organization_id TEXT NOT NULL,
  profile_key TEXT NOT NULL,
  profile_class TEXT NOT NULL,
  nominal_g REAL NOT NULL,
  snapshot_json TEXT NOT NULL,
  pulled_at TEXT NOT NULL,
  sync_state TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mass_composition_profiles_org_idx
  ON mass_composition_profiles(organization_id);
`,
};
