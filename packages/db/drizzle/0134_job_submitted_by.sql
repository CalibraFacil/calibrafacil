-- Separation of duties on the ACTUAL submitter (roadmap 2 B5, ISO/IEC 17025 §6.2.4).
--
-- Approval compared the approver with `technician_id` (the assignee) and `created_by`;
-- the person who actually submitted the job for review (a different member than the
-- assignee: an admin saving and submitting for the technician) was never recorded, so
-- they could approve their own submission. `submitted_by` / `submitted_at` record WHO
-- moved the job to REVIEW and WHEN; the submit command writes them on every entry point
-- (cloud route, public API, desktop sync), a resubmission overwrites them.
--
-- ON DELETE RESTRICT: an APPROVED/SUPERSEDED job is frozen by calibra_calibration_job_guard,
-- which lets a referential SET NULL through only for a short list of columns; the submitter
-- is also named by the append-only job_audit_log (performed_by, no cascade), so a user who
-- submitted a job cannot be hard-deleted in any case.
--
-- Backfill: every job that is NOT yet frozen (anything but APPROVED / SUPERSEDED) gets its
-- latest 'submit' audit row's actor and time. Approved and superseded jobs are frozen records
-- and the approval gate no longer applies to them: they keep NULL here (the submit audit row
-- is the evidence) rather than being rewritten through the audit-rewrite hatch. A job in
-- REVIEW with no 'submit' audit row (a legacy row) keeps NULL: approval then falls back to
-- the technician / creator checks, as before.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS; the constraint is added only when missing; the
-- backfill only fills NULLs). SET LOCAL lock_timeout fails fast instead of queueing behind
-- a long transaction while the short ACCESS EXCLUSIVE lock is taken.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "calibration_job" ADD COLUMN IF NOT EXISTS "submitted_by" text;
--> statement-breakpoint
ALTER TABLE "calibration_job" ADD COLUMN IF NOT EXISTS "submitted_at" timestamp;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'calibration_job_submitted_by_user_id_fk'
  ) THEN
    ALTER TABLE "calibration_job"
      ADD CONSTRAINT "calibration_job_submitted_by_user_id_fk"
      FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE RESTRICT;
  END IF;
END $$;
--> statement-breakpoint
UPDATE "calibration_job" AS j
   SET "submitted_by" = s."performed_by",
       "submitted_at" = s."performed_at"
  FROM (
    SELECT DISTINCT ON ("job_id", "organization_id")
           "job_id", "organization_id", "performed_by", "performed_at"
      FROM "job_audit_log"
     WHERE "action" = 'submit'
     ORDER BY "job_id", "organization_id", "performed_at" DESC, "id" DESC
  ) AS s
 WHERE s."job_id" = j."id"
   AND s."organization_id" = j."organization_id"
   AND j."submitted_by" IS NULL
   AND j."status" NOT IN ('APPROVED', 'SUPERSEDED');
