// Per-aggregate ordering, dependents that wait, and audited discards (roadmap 2 E1).
// Everything is additive: no queued event is touched, so a build that upgrades with
// pending, failed, dead or conflicting events keeps every one of them.
//
// - `outbox.blocked_by_event_id` / `blocked_at`: the event this one waits for (an earlier edit
//   of the same record, or its parent) that was refused for good or is in conflict. A blocked
//   event is still `pending`/`failed`; it is only not selected until the blocker is resolved
//   (`recomputeBlockedOutbox`, run on every start of a push and after every decision).
// - `outbox.discarded_by` / `discard_reason`: who gave an event up and why. `discarded_at`
//   already exists (migration 0021). The event row stays in `domain_events` as the trace.
// - `sync_conflicts.resolved_by` / `resolution_reason`: the same for a conflict. The new status
//   `discarded_by_user` replaces `ignored`, which older builds wrote while marking the change
//   `synced` although the cloud never received it; those rows keep the old status as history.
// - `sync_aggregate_versions`: the version the cloud last confirmed for an aggregate, which
//   the next event of that aggregate sends as its expected version. A row only exists after a
//   cloud that speaks versions acknowledged an event, so an upgraded desktop starts empty and
//   sends no expectation for rows it did not create (read as legacy by the cloud).
// - Indexes for the per-aggregate scan the selection does.
export const migration0025OutboxOrderingAndDiscard = {
  id: 25,
  name: "outbox_ordering_and_discard",
  sql: `
ALTER TABLE outbox ADD COLUMN blocked_by_event_id TEXT;
ALTER TABLE outbox ADD COLUMN blocked_at TEXT;
ALTER TABLE outbox ADD COLUMN discarded_by TEXT;
ALTER TABLE outbox ADD COLUMN discard_reason TEXT;

ALTER TABLE sync_conflicts ADD COLUMN resolved_by TEXT;
ALTER TABLE sync_conflicts ADD COLUMN resolution_reason TEXT;

CREATE TABLE IF NOT EXISTS sync_aggregate_versions (
  aggregate_kind TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  remote_version INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (aggregate_kind, aggregate_id)
);

CREATE INDEX IF NOT EXISTS domain_events_aggregate_sequence_idx
  ON domain_events (aggregate_kind, aggregate_id, sequence);
CREATE INDEX IF NOT EXISTS outbox_blocked_by_idx
  ON outbox (blocked_by_event_id)
  WHERE blocked_by_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS outbox_event_id_idx ON outbox (event_id);
`,
};
