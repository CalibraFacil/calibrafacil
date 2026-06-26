-- Customer-owned calibration interval + as-found reliability signal (issue #423).
--
-- The calibration interval/periodicity is the equipment owner's (customer's)
-- decision, never the lab's (ISO/IEC 17025:2017 §7.8.4.3 + ILAC-G24 / OIML D 10).
-- `asset.calibration_interval_months` (NULL = "aguardando definição do cliente")
-- plus provenance columns replace the lab-set next-calibration-date workflow; the
-- lab no longer attributes periodicity. `interval_rationale` is the §7.5 record.
--
-- `calibration_job.as_found_conformity` / `as_found_margins` persist the per-job
-- AS-FOUND (pre-adjustment) in-tolerance verdict — the reliability data foundation
-- for future ILAC-G24 / NCSL RP-1 interval optimization. Derived from the frozen
-- `results` (`margem_conformidade_antes`), never from the as-left `_apos` margin.
--
-- All additive + nullable; IF NOT EXISTS keeps it safe to re-run on the drizzle meta.
ALTER TABLE "asset" ADD COLUMN IF NOT EXISTS "calibration_interval_months" integer;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN IF NOT EXISTS "interval_set_by" text;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN IF NOT EXISTS "interval_set_at" timestamp;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN IF NOT EXISTS "interval_set_by_user_id" text;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN IF NOT EXISTS "interval_rationale" text;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD COLUMN IF NOT EXISTS "as_found_conformity" text;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD COLUMN IF NOT EXISTS "as_found_margins" jsonb;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "asset" ADD CONSTRAINT "asset_interval_set_by_user_id_user_id_fk" FOREIGN KEY ("interval_set_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
