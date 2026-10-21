// Rows a pull skipped because they had queued local changes. The pull cursor
// moves past them, so once those changes settle WITHOUT the cloud accepting
// them (a conflict ignored in favour of the cloud, say) nothing would ever bring
// the cloud's version back until that row changed in the cloud again. This
// remembers them, with the cloud version that was passed over, so the cursor
// can be rewound to it when the row is clean again.
export const migration0020SyncSkippedRows = {
  id: 20,
  name: "sync_skipped_rows",
  sql: `
CREATE TABLE IF NOT EXISTS sync_skipped_rows (
  entity_type TEXT NOT NULL,
  local_id TEXT NOT NULL,
  remote_id INTEGER NOT NULL,
  cloud_updated_at TEXT,
  skipped_at TEXT NOT NULL,
  PRIMARY KEY (entity_type, local_id)
);
`,
};
