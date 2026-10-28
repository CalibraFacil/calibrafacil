-- Server-side expected version for desktop sync pushes (roadmap 2 E1).
--
-- A desktop write used to be checked against the row's `updatedAt` only (a timestamp: ms
-- resolution, waived inside a push batch), so an older autosave replayed after a newer one, or a
-- second device that pulled the same row, could overwrite it silently. Each pushed event now
-- carries the version of its aggregate (entity_type + entity_id) the desktop expects; the cloud
-- refuses a write whose expectation is not the current version as a `stale_version` conflict.
--
-- No new table: `sync_applied_event` already holds exactly one row per desktop event the cloud
-- applied (unique per organization and event id, so a replay never adds one). The version an
-- event produced is stored on its row, and the aggregate's current version is the largest one.
-- Rows written before this migration keep NULL (read as version 0); a desktop that sends no
-- expectation (an older build, or the first write to a row it only pulled) is applied as before.
--
-- Idempotent (IF NOT EXISTS): this project applies migration DDL by hand and the drizzle
-- bookkeeping table lags behind it. No tenant table is added, so the RLS block is unchanged.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "sync_applied_event" ADD COLUMN IF NOT EXISTS "aggregate_version" integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_applied_event_aggregate_idx"
  ON "sync_applied_event" USING btree ("organization_id", "entity_type", "entity_id");
