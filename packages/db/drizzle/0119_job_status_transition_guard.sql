-- The calibration_job status machine, enforced in Postgres (roadmap P2-6).
--
-- packages/schemas/src/job-transitions.ts is the single owner of which status may
-- follow which, and every app writer asks it. Nothing stopped a stray UPDATE (a
-- script, a future writer, a manual fix) from moving an APPROVED job back to
-- DRAFT. This migration adds a BEFORE INSERT OR UPDATE OF status trigger on
-- calibration_job:
--
--   * UPDATE: a status change must be a move of JOB_TRANSITIONS; a no-op rewrite
--     (A -> A) is always allowed. Anything else raises
--     'calibra: illegal job transition A -> B', SQLSTATE CF001 (not P0001), so
--     the statement fails.
--   * INSERT: only the status `create` lands in (DRAFT). The amendment clone is
--     inserted in DRAFT too; the only writers of other statuses were test
--     fixtures.
--   * Escape hatch for audited data repair, same convention as the immutability
--     triggers of migration 0115: `SET LOCAL calibra.allow_status_repair = 'on'`
--     inside a transaction (reverts at COMMIT/ROLLBACK). The seed hatch
--     `calibra.allow_audit_rewrite` lifts it as well. Nothing in the application
--     sets either.
--
-- Existing rows are not re-validated: production data that already sits in a
-- state the table would not produce does not block this migration; the trigger
-- only checks UPDATEs of the status going forward (and INSERTs).
--
-- The function between the BEGIN/END markers is GENERATED from JOB_TRANSITIONS
-- (`pnpm --filter @calibra-facil/db gen:job-transitions-sql`); a drift guard
-- (packages/db/src/job-transitions-sql.test.ts) fails when this block, or the
-- copy in sql/schema-extras.sql, differs from what the current table generates.
-- When the table changes, ship a NEW migration that redefines the function; do
-- not edit this one.
--
-- Triggers run in name order: calibration_job_status_transition_guard fires after
-- calibration_job_immutable_guard (0115), so a status change on a frozen
-- APPROVED/SUPERSEDED job is still reported as a frozen column; this guard
-- answers for every job that is not frozen (and for the one move a frozen job
-- may make, the amendment APPROVED -> SUPERSEDED).
--
-- Idempotent (CREATE OR REPLACE / DROP TRIGGER IF EXISTS), because this project
-- applies migration DDL by hand and the drizzle bookkeeping table lags behind it.
-- Functions and triggers are not expressible in schema.ts, so the same objects
-- are repeated in sql/schema-extras.sql (used to build new databases).
-- BEGIN generated: calibra_calibration_job_status_guard
CREATE OR REPLACE FUNCTION calibra_calibration_job_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('DRAFT') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal job creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A calibration job is created in DRAFT and walks the state machine.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('DRAFT', 'IN_PROGRESS'),
    ('DRAFT', 'REVIEW'),
    ('IN_PROGRESS', 'REVIEW'),
    ('REJECTED', 'REVIEW'),
    ('REVIEW', 'REJECTED'),
    ('REVIEW', 'GENERATING_PDF'),
    ('GENERATING_PDF', 'APPROVED'),
    ('GENERATING_PDF', 'REJECTED'),
    ('GENERATING_PDF', 'REVIEW'),
    ('DRAFT', 'CANCELED'),
    ('IN_PROGRESS', 'CANCELED'),
    ('REVIEW', 'CANCELED'),
    ('REJECTED', 'CANCELED'),
    ('APPROVED', 'SUPERSEDED')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal job transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the job with the lifecycle commands (packages/schemas job-transitions.ts); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_calibration_job_status_guard
--> statement-breakpoint
DROP TRIGGER IF EXISTS calibration_job_status_transition_guard ON public.calibration_job;
CREATE TRIGGER calibration_job_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.calibration_job
  FOR EACH ROW EXECUTE FUNCTION calibra_calibration_job_status_guard();
