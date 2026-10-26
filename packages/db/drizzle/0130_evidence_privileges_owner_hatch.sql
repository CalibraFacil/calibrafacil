-- Evidence immutability that the application role cannot lift (roadmap 2, B1; ISO/IEC 17025
-- 7.5.2, 8.4, 7.11.3).
--
-- Until now `calibra_app` (the role the API, the worker and the CLI connect as) held SELECT,
-- INSERT, UPDATE and DELETE on every table, and the immutability triggers of migrations 0115,
-- 0119 and 0120 yielded to GUCs (`calibra.allow_audit_rewrite`, `calibra.allow_status_repair`,
-- `calibra.allow_org_purge`) that ANY session can set with set_config(). A defect or an injected
-- statement in the application could therefore rewrite or delete audit rows and frozen records.
-- This migration closes both doors:
--
--   1. PRIVILEGES. UPDATE, DELETE and TRUNCATE are revoked from `calibra_app` on the append-only
--      evidence tables (the 22 *_audit_log tables, organization_event_log, integration_event_log,
--      service_order_event_log and issued_certificate_snapshot), and UPDATE and TRUNCATE on
--      certificate_input. INSERT and SELECT stay. Left to the triggers alone, with the reason in
--      packages/db/src/evidence-tables.ts: calibration_job (the application UPDATEs it until
--      approval), certificate_input DELETE (an approval reverted while the job is in REVIEW),
--      platform_event_log (the public-signup reservation row) and organization (CLIENT
--      organizations are deleted by the application). The ON DELETE SET NULL actions of foreign
--      keys on the append-only tables keep working: Postgres runs them as the table owner.
--      The block is GENERATED (`pnpm --filter @calibra-facil/db gen:rls-sql evidence`) from the
--      lists in evidence-tables.ts; rls-sql.test.ts fails when this block, or the copy in
--      sql/schema-extras.sql, differs from what those lists generate. Anything that repeats the
--      blanket `GRANT ... ON ALL TABLES` of migration 0123 must repeat this block right after it.
--
--   2. THE ESCAPE HATCH IS GATED ON ROLE, NOT ONLY ON A GUC. `calibra_session_is_owner()` is true
--      only when both the session user and the current user are the table owner or members of it
--      (pg_has_role MEMBER; the owner of `organization` is the reference; a superuser is a member
--      of every role). `calibra_history_rewrite_allowed()` now needs the setting AND the owner,
--      `calibra_org_purge_allowed()` likewise, and the status-repair hatch of the calibration_job
--      status guard (regenerated below) too. A calibra_app session that sets any of the GUCs gets
--      nothing. The session user is checked as well so that a foreign-key action, which Postgres
--      runs as the table owner, cannot be turned into a bypass by an application session that set
--      the GUC first. The functions pin their search_path.
--      Who still uses the hatches: the owner connection only (DATABASE_OWNER_URL, `systemDb`): the
--      records purge, the demo seed, an audited repair run by an operator in psql, the test
--      harness. The cleanup of a just-created organization (removeLabOrganization) moved to that
--      path in the same change.
--
-- Existing rows are not touched. Idempotent (CREATE OR REPLACE; REVOKE of a privilege not held is
-- a no-op), because this project applies migration DDL by hand and the drizzle bookkeeping table
-- lags behind it. Functions are not expressible in schema.ts, so the same objects are repeated in
-- sql/schema-extras.sql (used to build new databases).
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION calibra_session_is_owner()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT pg_has_role(
           session_user,
           (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.organization'::regclass),
           'MEMBER')
     AND pg_has_role(
           current_user,
           (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.organization'::regclass),
           'MEMBER')
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION calibra_history_rewrite_allowed()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT public.calibra_session_is_owner()
     AND coalesce(current_setting('calibra.allow_audit_rewrite', true), '') = 'on'
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION calibra_org_purge_allowed()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT public.calibra_session_is_owner()
     AND (public.calibra_history_rewrite_allowed()
          OR coalesce(current_setting('calibra.allow_org_purge', true), '') = 'on')
$$;
--> statement-breakpoint
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
--> statement-breakpoint
-- BEGIN generated: calibra_evidence_grants
REVOKE UPDATE, DELETE, TRUNCATE ON public."accredited_scope_line_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."asset_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."asset_oot_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."authorized_signatory_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."automatic_send_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."calibration_request_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."certificate_numbering_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."certificate_release_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."control_chart_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."corrective_action_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."customer_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."financial_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."integration_event_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."issued_certificate_snapshot" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."job_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."method_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."non_conformance_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."organization_api_key_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."organization_event_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."personnel_competence_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."proficiency_test_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."reference_standard_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."service_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."service_order_event_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."training_record_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."visit_audit_log" FROM calibra_app;
REVOKE UPDATE, TRUNCATE ON public."certificate_input" FROM calibra_app;
-- END generated: calibra_evidence_grants
