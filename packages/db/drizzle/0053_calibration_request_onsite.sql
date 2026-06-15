-- On-site calibration (calibração in loco): a customer can now request that a
-- lab technician travels to them instead of shipping the instrument. We capture
-- the visit address (defaults to the customer's registered address server-side
-- when omitted) and the customer's preferred visit date on the request. The
-- delivery_method text column already accepts the new "onsite" value, so only
-- these two additive columns are needed. Existing rows are unaffected (NULL).
-- (IF NOT EXISTS keeps this safe to re-run on the drizzle meta in its current state.)
ALTER TABLE "calibration_request" ADD COLUMN IF NOT EXISTS "onsite_address" jsonb;--> statement-breakpoint
ALTER TABLE "calibration_request" ADD COLUMN IF NOT EXISTS "preferred_visit_date" timestamp with time zone;
