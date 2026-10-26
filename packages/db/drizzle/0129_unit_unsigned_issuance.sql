-- Explicit, audited per-unit setting to issue certificates UNSIGNED on purpose (decision Q51).
--
-- Since P0-8 a unit that has ever had a signing certificate and has none valid fails closed
-- (no unsigned PDF). A lab that really intends to stop signing needs a way out that is never
-- implicit: these columns. `unsigned_issuance_reason` non-NULL = the setting is on, and it
-- holds the mandatory justification (min length validated by the API schema); who set it
-- and when are kept next to it. The change itself is written to `organization_event_log`
-- (the organization audit trail) by the route, in the same transaction.
--
-- All three columns are NULL by default: no unit is affected, nothing is turned on by this
-- migration. `unsigned_issuance_set_by` follows the other user references of the table
-- (ON DELETE SET NULL).
--
-- Idempotent (ADD COLUMN IF NOT EXISTS; the constraint is added only when missing). SET LOCAL
-- lock_timeout fails fast instead of queueing behind a long transaction while the short
-- ACCESS EXCLUSIVE lock is taken.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "organization_unit" ADD COLUMN IF NOT EXISTS "unsigned_issuance_reason" text;
--> statement-breakpoint
ALTER TABLE "organization_unit" ADD COLUMN IF NOT EXISTS "unsigned_issuance_set_by" text;
--> statement-breakpoint
ALTER TABLE "organization_unit" ADD COLUMN IF NOT EXISTS "unsigned_issuance_set_at" timestamp;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organization_unit_unsigned_issuance_set_by_user_id_fk'
  ) THEN
    ALTER TABLE "organization_unit"
      ADD CONSTRAINT "organization_unit_unsigned_issuance_set_by_user_id_fk"
      FOREIGN KEY ("unsigned_issuance_set_by") REFERENCES "public"."user"("id") ON DELETE SET NULL;
  END IF;
END $$;
