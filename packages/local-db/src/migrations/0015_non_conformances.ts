export const migration0015NonConformances = {
  id: 15,
  name: "non_conformances",
  sql: `
CREATE TABLE IF NOT EXISTS non_conformances (
  id TEXT PRIMARY KEY,
  remote_id INTEGER,
  nc_number TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  unit_id INTEGER,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  detected_by TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_state TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS non_conformances_org_idx
  ON non_conformances(organization_id);
`,
} as const;
