// Protocol 3 (the commit-ordered pull and the paged bootstrap,
// docs/architecture/sync-change-seq.md).
//
// - `sync_skipped_rows.resume_cursor`: the pull cursor that returns a skipped row's
//   change again. A skipped row's `cloud_updated_at` rewinds an `updatedAt` cursor;
//   a change-log cursor is rewound by the log position of the change instead. NULL
//   (a row skipped by a bootstrap page, which has no log position) means "start over".
// - `sync_bootstrap_seen`: the rows the pages of the bootstrap in progress delivered.
//   When the last page is applied, a mirror row the cloud no longer sends (deleted, or
//   moved out of this desktop's scope while it was offline longer than the change log is
//   kept) is the one that is not in it. Emptied when a bootstrap starts and completes.
// - The in-progress bootstrap itself needs no table: its page token lives in
//   `sync_cursors` under the scope `bootstrap-page`.
export const migration0023SyncChangeSeq = {
  id: 23,
  name: "sync_change_seq",
  sql: `
ALTER TABLE sync_skipped_rows ADD COLUMN resume_cursor TEXT;

CREATE TABLE IF NOT EXISTS sync_bootstrap_seen (
  entity_type TEXT NOT NULL,
  remote_id INTEGER NOT NULL,
  PRIMARY KEY (entity_type, remote_id)
);
`,
};
