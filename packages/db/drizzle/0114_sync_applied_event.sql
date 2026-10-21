-- Replay protection for desktop sync pushes that holds under concurrency. The
-- audit-log lookup that used to be the only dedup is a read-then-write: two
-- concurrent pushes of the same op id could both miss it and both apply. The
-- unique (organization_id, event_id) index makes the claim atomic. Rows applied
-- before this migration have no row here; the push handler still falls back to
-- organization_event_log for them.
--
-- Idempotent, because this project applies migration DDL by hand and the
-- drizzle bookkeeping table lags behind it.
CREATE TABLE IF NOT EXISTS "sync_applied_event" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "event_id" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL,
  "claimed_at" timestamp DEFAULT now() NOT NULL,
  "applied_at" timestamp,
  "result" jsonb
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sync_applied_event"
    ADD CONSTRAINT "sync_applied_event_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sync_applied_event_org_event_uidx"
  ON "sync_applied_event" USING btree ("organization_id", "event_id");
