// REL-01 slice 1: give locally-editable, cloud-synced rows a base-version anchor.
// `remote_base_updated_at` records the cloud row's `updatedAt` captured at
// cloud-pull time. Local edits never touch it, so it preserves the base version
// the edit was made against; the outbox transmits it per event as `baseUpdatedAt`
// so the server can later detect divergence. Nullable: legacy rows and rows that
// were never pulled carry NULL ("cannot check").
export const migration0014SyncBaseVersionAnchor = {
  id: 14,
  name: "sync_base_version_anchor",
  sql: `
ALTER TABLE assets ADD COLUMN remote_base_updated_at TEXT;
ALTER TABLE customers ADD COLUMN remote_base_updated_at TEXT;
ALTER TABLE service_order_executions ADD COLUMN remote_base_updated_at TEXT;
`,
};
