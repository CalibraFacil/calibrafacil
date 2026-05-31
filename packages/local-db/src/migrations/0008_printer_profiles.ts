export const migration0008PrinterProfiles = {
  id: 8,
  name: "printer_profiles",
  sql: `
CREATE TABLE IF NOT EXISTS printer_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  connection_json TEXT NOT NULL,
  dpi INTEGER NOT NULL,
  darkness INTEGER NOT NULL,
  speed INTEGER NOT NULL,
  width_dots INTEGER NOT NULL,
  height_dots INTEGER NOT NULL,
  offsets_json TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
};
