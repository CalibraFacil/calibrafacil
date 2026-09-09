-- Activation milestones for the self-serve onboarding checklist.
--
-- The checklist itself is derived on read from the domain tables, because a
-- stored completion flag goes stale the moment the underlying record changes
-- and a stale checklist lies to the laboratory. These columns answer a
-- different question: not "can this organization do X right now" but "did it
-- ever reach X, and when". That one cannot be derived once the triggering row
-- is deleted, and it is what activation and time-to-value analytics need.
--
-- Written once, with COALESCE, by the domain paths that complete each step,
-- and never read back to drive the UI. A missed write costs a metric, never a
-- user-facing claim.
-- Idempotent on purpose: this project applies migration DDL by hand and the
-- drizzle bookkeeping table lags behind, so a later `db:migrate` will replay
-- entries whose effects are already in the database.
ALTER TABLE "organization_success_profile"
  ADD COLUMN IF NOT EXISTS "organization_profile_completed_at" timestamp,
  ADD COLUMN IF NOT EXISTS "first_method_published_at" timestamp,
  ADD COLUMN IF NOT EXISTS "first_reference_standard_at" timestamp,
  ADD COLUMN IF NOT EXISTS "first_signing_certificate_at" timestamp,
  ADD COLUMN IF NOT EXISTS "first_customer_created_at" timestamp,
  ADD COLUMN IF NOT EXISTS "first_certificate_issued_at" timestamp;
