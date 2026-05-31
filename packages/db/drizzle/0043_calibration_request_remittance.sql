-- Calibration requests can now record how the customer delivers the assets and,
-- when shipping via a carrier, the "nota fiscal de remessa para conserto" so the
-- lab can receive the goods and later issue the return invoice. Mirrors the
-- service_order remittance fields. Additive columns — existing rows default to
-- a counter drop-off and NULL remittance, so no existing query is affected.
-- (IF NOT EXISTS keeps this safe to re-run on the drizzle meta in its current state.)
ALTER TABLE "calibration_request" ADD COLUMN IF NOT EXISTS "delivery_method" text DEFAULT 'dropoff' NOT NULL;--> statement-breakpoint
ALTER TABLE "calibration_request" ADD COLUMN IF NOT EXISTS "invoice_remittance_number" text;--> statement-breakpoint
ALTER TABLE "calibration_request" ADD COLUMN IF NOT EXISTS "invoice_remittance_key" text;--> statement-breakpoint
ALTER TABLE "calibration_request" ADD COLUMN IF NOT EXISTS "invoice_remittance_issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calibration_request" ADD COLUMN IF NOT EXISTS "carrier_name" text;
