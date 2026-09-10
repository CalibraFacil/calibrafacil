// Records which account and organization this database file belongs to.
//
// The desktop keeps one SQLite file per (account, organization) partition, but
// the *path* is not the boundary — a file is readable by anyone with enough
// operating-system access, and a wrong path is a bug rather than an
// impossibility. This row is what the database manager checks before serving a
// single read, so opening the wrong file fails loudly instead of quietly
// handing one account another's calibration records.
//
// Single-row by construction: `id` is pinned to 1.
export const migration0019LocalDatabaseOwner = {
  id: 19,
  name: "local_database_owner",
  sql: `
CREATE TABLE IF NOT EXISTS local_database_owner (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  user_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  claimed_at TEXT NOT NULL
);
`,
};
