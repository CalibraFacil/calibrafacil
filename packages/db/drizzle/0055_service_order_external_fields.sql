-- Service Order print/flow gaps: external / in-loco support + actual work start.
-- `is_external_service` marks an OS where the technician travels to the client
-- (drives rendering the client service address on the lab print copy).
-- `service_started_at` records when the budget/service actually started, distinct
-- from opened_at (OS creation); nullable + editable, not auto-set.
-- Both additive; existing rows are unaffected (default false / NULL).
-- (IF NOT EXISTS keeps this safe to re-run on the drizzle meta in its current state.)
ALTER TABLE "service_order" ADD COLUMN IF NOT EXISTS "is_external_service" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "service_order" ADD COLUMN IF NOT EXISTS "service_started_at" timestamp;
