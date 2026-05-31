export const migration0005SyncConflictEventId = {
  id: 5,
  name: "sync_conflict_event_id",
  sql: `
ALTER TABLE sync_conflicts ADD COLUMN event_id TEXT;
`,
};
