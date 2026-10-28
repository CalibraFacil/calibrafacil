-- A failed certificate render is its own state (roadmap 2 C5, review 3.1).
--
-- Until now a render that failed (the worker's own error, a dead-lettered queue row or the
-- stuck-render sweep) moved the job GENERATING_PDF -> REJECTED, indistinguishable from a
-- reviewer's rejection, and the only way forward was to resubmit and approve again. A failed
-- render now lands in RENDER_FAILED: the approval, its verdict and its frozen certificate input
-- stand. From there a manager retries the render (RENDER_FAILED -> GENERATING_PDF, POST
-- /api/jobs/:id/retry-render) or rejects the job back to rework (RENDER_FAILED -> REJECTED).
--
-- The status column is text (no enum to extend); this redefines the transition guard with the
-- three new pairs. The block is GENERATED from packages/schemas job-transitions.ts
-- (`pnpm --filter @calibra-facil/db gen:job-transitions-sql`); job-transitions-sql.test.ts fails
-- when it, or the copy in sql/schema-extras.sql, differs from what the table generates.
--
-- Jobs a failed render already moved to REJECTED stay REJECTED (their history is evidence).
-- BEGIN generated: calibra_calibration_job_status_guard
CREATE OR REPLACE FUNCTION calibra_calibration_job_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
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
    ('RENDER_FAILED', 'REJECTED'),
    ('REVIEW', 'GENERATING_PDF'),
    ('GENERATING_PDF', 'APPROVED'),
    ('GENERATING_PDF', 'RENDER_FAILED'),
    ('RENDER_FAILED', 'GENERATING_PDF'),
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
