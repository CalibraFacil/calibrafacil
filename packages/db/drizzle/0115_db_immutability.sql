-- Regulated invariants enforced in Postgres, not only in application code.
--
--   1. calibration_job: APPROVED / SUPERSEDED jobs are frozen (see
--      calibra_calibration_job_guard) and cannot be deleted.
--   2. issued_certificate_snapshot and the evidence tables (the 22 *_audit_log
--      tables plus organization_event_log, integration_event_log,
--      service_order_event_log and platform_event_log) are append-only.
--   3. Seven evidence tables lose their ON DELETE CASCADE foreign keys (the
--      CMP-07 / #692 precedent, migration 0081): their columns and indexes stay,
--      the references become soft, so evidence survives deletion of the
--      organization, unit, service order, integration or run it documents.
--
-- Existing rows are not re-validated: the triggers apply to future writes.
-- Functions and triggers are not expressible in schema.ts, so the same objects
-- are repeated in sql/schema-extras.sql (used to build new databases).
--
-- Idempotent, because this project applies migration DDL by hand and the
-- drizzle bookkeeping table lags behind it.
-- The constraint names are looked up instead of hard-coded: they were truncated
-- by Postgres and differ between databases built from the migration chain and
-- from schema.ts.
DO $$
DECLARE
  fk record;
BEGIN
  FOR fk IN
    SELECT conrelid::regclass AS tbl, conname
      FROM pg_constraint
     WHERE contype = 'f'
       AND confdeltype = 'c'
       AND conrelid IN (
         to_regclass('public.certificate_numbering_audit_log'),
         to_regclass('public.financial_audit_log'),
         to_regclass('public.accredited_scope_line_audit_log'),
         to_regclass('public.automatic_send_audit_log'),
         to_regclass('public.organization_event_log'),
         to_regclass('public.integration_event_log'),
         to_regclass('public.service_order_event_log')
       )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.tbl, fk.conname);
  END LOOP;
END
$$;
--> statement-breakpoint
-- Regulated invariants enforced in Postgres (migration 0115).
--
-- Escape hatch. Seeded demo data rewrites history on purpose (back-dated
-- `performed_at`, `approved_at`, ...). `SET LOCAL calibra.allow_audit_rewrite =
-- 'on'` lifts every immutability trigger below for the current transaction only
-- (SET LOCAL reverts at COMMIT/ROLLBACK). As written in this migration it was a
-- convention for apps/api/src/cli/seed-demo, not a security boundary: any session
-- could set it. Migration 0130 (roadmap 2 B1) gates it on the table owner
-- (calibra_session_is_owner()): a calibra_app session that sets it lifts nothing.
CREATE OR REPLACE FUNCTION calibra_history_rewrite_allowed()
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT coalesce(current_setting('calibra.allow_audit_rewrite', true), '') = 'on'
$$;
--> statement-breakpoint
-- Append-only guard for evidence tables: the *_audit_log tables, the event logs
-- and issued_certificate_snapshot. UPDATE and DELETE raise, except:
--   * the seed escape hatch above;
--   * a referential ON DELETE SET NULL action (an UPDATE issued by a foreign
--     key, so pg_trigger_depth() > 1) that only nulls columns out: deleting a
--     user/unit/rule must not be blocked by, nor erase, the evidence naming it;
--   * a trigger argument 'signup_reservation' (platform_event_log only): the
--     public-signup reservation row is operational until the signup completes.
-- TRUNCATE does not fire row triggers; it stays available to test harnesses.
CREATE OR REPLACE FUNCTION calibra_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_j jsonb := to_jsonb(OLD);
  new_j jsonb;
BEGIN
  IF calibra_history_rewrite_allowed() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_NARGS > 0 AND TG_ARGV[0] = 'signup_reservation'
     AND old_j ->> 'action' = 'public.signup.provisioned'
     AND old_j -> 'details' ->> 'status' = 'RESERVED' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 THEN
    new_j := to_jsonb(NEW);
    IF NOT EXISTS (
      SELECT 1
        FROM jsonb_each(old_j) o
        JOIN jsonb_each(new_j) n ON n.key = o.key
       WHERE o.value IS DISTINCT FROM n.value
         AND n.value <> 'null'::jsonb
    ) THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION '% row % is append-only evidence: % is not allowed',
    TG_TABLE_NAME, coalesce(old_j ->> 'id', '?'), TG_OP
    USING ERRCODE = 'P0001',
          TABLE = TG_TABLE_NAME,
          HINT = 'Record a new row instead of rewriting or deleting an existing one.';
END
$$;
--> statement-breakpoint
-- calibration_job guard: once a job is APPROVED or SUPERSEDED its regulated
-- content is frozen. Everything not on the allow-list below is frozen (so a
-- column added later is protected by default). Allowed on such a job:
--   * updated_at, label_url: operational (the worker stores the thermal label
--     after approval);
--   * the amendment itself, APPROVED -> SUPERSEDED while superseded_by_id goes
--     from NULL to a job: status, superseded_by_id, superseded_at,
--     amendment_reason;
--   * write-once values: certificate_url, signature_metadata, signature_verdict,
--     as_found_conformity, as_found_margins may move from NULL to a value (the
--     as-found backfill script) but never change once set;
--   * visit_id, source_service_order_id, technician_id, approved_by, rejected_by
--     set to NULL only by a referential ON DELETE SET NULL action (a visit, repair
--     order or user deleted), never by a direct UPDATE.
-- DELETE of an APPROVED/SUPERSEDED job is refused. The seed escape hatch applies.
CREATE OR REPLACE FUNCTION calibra_calibration_job_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_j jsonb;
  new_j jsonb;
  col text;
  amending boolean;
BEGIN
  IF OLD.status NOT IN ('APPROVED', 'SUPERSEDED')
     OR calibra_history_rewrite_allowed() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'calibration_job % (%): a % job cannot be deleted',
      OLD.id, OLD.job_id, OLD.status
      USING ERRCODE = 'P0001',
            TABLE = TG_TABLE_NAME,
            HINT = 'Approved certificates are retained; amend the job instead of deleting it.';
  END IF;

  old_j := to_jsonb(OLD);
  new_j := to_jsonb(NEW);
  amending := OLD.status = 'APPROVED'
          AND NEW.status = 'SUPERSEDED'
          AND OLD.superseded_by_id IS NULL
          AND NEW.superseded_by_id IS NOT NULL;

  FOR col IN
    SELECT o.key
      FROM jsonb_each(old_j) o
      JOIN jsonb_each(new_j) n ON n.key = o.key
     WHERE o.value IS DISTINCT FROM n.value
     ORDER BY o.key
  LOOP
    CONTINUE WHEN col IN ('updated_at', 'label_url');
    CONTINUE WHEN amending
              AND col IN ('status', 'superseded_by_id', 'superseded_at', 'amendment_reason');
    -- Test the column itself: a jsonb column holding JSON null is already set.
    CONTINUE WHEN CASE col
                    WHEN 'certificate_url' THEN OLD.certificate_url IS NULL
                    WHEN 'signature_metadata' THEN OLD.signature_metadata IS NULL
                    WHEN 'signature_verdict' THEN OLD.signature_verdict IS NULL
                    WHEN 'as_found_conformity' THEN OLD.as_found_conformity IS NULL
                    WHEN 'as_found_margins' THEN OLD.as_found_margins IS NULL
                    ELSE false
                  END;
    CONTINUE WHEN col IN ('visit_id', 'source_service_order_id',
                          'technician_id', 'approved_by', 'rejected_by')
              AND new_j -> col = 'null'::jsonb
              AND pg_trigger_depth() > 1;

    RAISE EXCEPTION 'calibration_job % (%): column % is frozen on a % job',
      OLD.id, OLD.job_id, col, OLD.status
      USING ERRCODE = 'P0001',
            TABLE = TG_TABLE_NAME,
            COLUMN = col,
            HINT = 'Approved certificates are immutable; amend the job instead of editing it in place.';
  END LOOP;

  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS calibration_job_immutable_guard ON public.calibration_job;
--> statement-breakpoint
CREATE TRIGGER calibration_job_immutable_guard
  BEFORE UPDATE OR DELETE ON public.calibration_job
  FOR EACH ROW EXECUTE FUNCTION calibra_calibration_job_guard();
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'issued_certificate_snapshot',
    'certificate_numbering_audit_log',
    'organization_api_key_audit_log',
    'customer_audit_log',
    'asset_audit_log',
    'method_audit_log',
    'service_audit_log',
    'reference_standard_audit_log',
    'job_audit_log',
    'financial_audit_log',
    'automatic_send_audit_log',
    'certificate_release_audit_log',
    'calibration_request_audit_log',
    'visit_audit_log',
    'accredited_scope_line_audit_log',
    'corrective_action_audit_log',
    'non_conformance_audit_log',
    'personnel_competence_audit_log',
    'training_record_audit_log',
    'authorized_signatory_audit_log',
    'proficiency_test_audit_log',
    'control_chart_audit_log',
    'asset_oot_audit_log',
    'organization_event_log',
    'integration_event_log',
    'service_order_event_log'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_append_only', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION calibra_append_only()',
      t || '_append_only', t);
  END LOOP;
END
$$;
--> statement-breakpoint
-- platform_event_log holds the public-signup reservation row, which
-- public-signup.ts updates when the signup completes and deletes when it fails.
-- Only that row (action public.signup.provisioned, details.status RESERVED) may
-- be changed; every other platform event is append-only.
DROP TRIGGER IF EXISTS platform_event_log_append_only ON public.platform_event_log;
--> statement-breakpoint
CREATE TRIGGER platform_event_log_append_only
  BEFORE UPDATE OR DELETE ON public.platform_event_log
  FOR EACH ROW EXECUTE FUNCTION calibra_append_only('signup_reservation');
