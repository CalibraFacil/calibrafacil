-- Legal-metrology regime + regulation-fixed verification periodicity (issue #423).
--
-- TRACK 2, independent of the customer-owned calibration interval (0065): an instrument
-- under Inmetro / RBMLQ-I legal control has a VERIFICATION periodicity FIXED BY REGULATION
-- — neither the lab nor the customer sets it. `metrology_regime` is the lab-set source of
-- truth (replaces `subject_to_legal_metrology`, kept consistent during the transition);
-- `regulated_interval` is the structured period (validated by RegulatedIntervalSchema at
-- the API boundary); `next_legal_verification_date` is derived from it (SEPARATE from
-- `next_calibration_date`, which stays the customer's).
--
-- Additive; regime defaults INDUSTRIAL, then backfills LEGAL from the existing boolean.
-- IF NOT EXISTS keeps it safe to re-run on the drizzle meta.
ALTER TABLE "asset" ADD COLUMN IF NOT EXISTS "metrology_regime" text DEFAULT 'INDUSTRIAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN IF NOT EXISTS "regulated_interval" jsonb;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN IF NOT EXISTS "next_legal_verification_date" timestamp;--> statement-breakpoint
UPDATE "asset" SET "metrology_regime" = 'LEGAL' WHERE "subject_to_legal_metrology" = true;
