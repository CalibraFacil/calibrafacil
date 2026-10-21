-- Database objects that live only in migrations because src/schema.ts cannot
-- express them, so `drizzle-kit push` does not create them. Applied by
-- `pnpm --dir packages/db db:bootstrap` right after pushing the schema into a new
-- database. Every statement is idempotent.
--
-- Keep this file in sync whenever a migration adds an object of this kind
-- (extension, function, partial/expression index, CHECK constraint).

-- Accent-insensitive search (migration 0071).
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

CREATE INDEX IF NOT EXISTS customer_name_unaccent_trgm_idx
  ON public.customer USING gin (lower(immutable_unaccent(name)) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customer_trade_name_unaccent_trgm_idx
  ON public.customer USING gin (lower(immutable_unaccent(trade_name)) gin_trgm_ops);

-- Partial unique indexes with NULLS NOT DISTINCT (migration 0083): schema.ts can
-- only describe an approximate, non-partial version, which push creates first.
ALTER TABLE personnel_competence DROP CONSTRAINT IF EXISTS competence_org_user_asset_type_uidx;
DROP INDEX IF EXISTS competence_org_user_asset_type_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS competence_org_user_asset_type_uidx
  ON public.personnel_competence USING btree (organization_id, user_id, asset_type_id)
  NULLS NOT DISTINCT WHERE (user_id IS NOT NULL);

ALTER TABLE authorized_signatory DROP CONSTRAINT IF EXISTS authorized_signatory_org_user_asset_type_uidx;
DROP INDEX IF EXISTS authorized_signatory_org_user_asset_type_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS authorized_signatory_org_user_asset_type_uidx
  ON public.authorized_signatory USING btree (organization_id, user_id, asset_type_id)
  NULLS NOT DISTINCT WHERE (user_id IS NOT NULL);

-- One current certificate document per reference standard (migration 0023).
CREATE UNIQUE INDEX IF NOT EXISTS standard_certificate_document_one_current_uidx
  ON public.reference_standard_certificate_document USING btree (standard_id)
  WHERE (is_current = true);

-- One organization-wide default release policy / automatic-send rule
-- (migrations 0029 and 0031).
CREATE UNIQUE INDEX IF NOT EXISTS certificate_release_policy_org_default_uidx
  ON public.certificate_release_policy USING btree (organization_id)
  WHERE ((customer_id IS NULL) AND (commercial_agreement_id IS NULL)
    AND (service_category IS NULL) AND (archived_at IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS automatic_send_rule_org_default_uidx
  ON public.automatic_send_rule USING btree (organization_id)
  WHERE ((customer_id IS NULL) AND (commercial_agreement_id IS NULL)
    AND (service_category IS NULL) AND (archived_at IS NULL));

-- Accredited-scope expiry lookups (migration 0100).
CREATE INDEX IF NOT EXISTS accredited_scope_line_valid_until_idx
  ON public.accredited_scope_line USING btree (valid_until)
  WHERE (valid_until IS NOT NULL);

-- Key custody per sending mode (migration 0110).
ALTER TABLE organization_email_domain
  DROP CONSTRAINT IF EXISTS organization_email_domain_mode_key_custody;
ALTER TABLE organization_email_domain
  ADD CONSTRAINT organization_email_domain_mode_key_custody CHECK (
    (
      mode = 'byok'
      AND resend_api_key_encrypted IS NOT NULL
      AND resend_api_key_iv IS NOT NULL
      AND resend_api_key_last4 IS NOT NULL
    )
    OR (
      mode = 'managed'
      AND resend_api_key_encrypted IS NULL
      AND resend_api_key_iv IS NULL
      AND resend_api_key_last4 IS NULL
    )
  );

-- Regulated invariants enforced in Postgres (migration 0115). The ON DELETE
-- CASCADE foreign keys that migration drops are simply absent from schema.ts.
--
-- Escape hatch. Seeded demo data rewrites history on purpose (back-dated
-- `performed_at`, `approved_at`, ...). `SET LOCAL calibra.allow_audit_rewrite =
-- 'on'` lifts every immutability trigger below for the current transaction only
-- (SET LOCAL reverts at COMMIT/ROLLBACK). It is a convention for
-- apps/api/src/cli/seed-demo, not a security boundary: nothing in the
-- application sets it.
CREATE OR REPLACE FUNCTION calibra_history_rewrite_allowed()
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT coalesce(current_setting('calibra.allow_audit_rewrite', true), '') = 'on'
$$;
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
DROP TRIGGER IF EXISTS calibration_job_immutable_guard ON public.calibration_job;
CREATE TRIGGER calibration_job_immutable_guard
  BEFORE UPDATE OR DELETE ON public.calibration_job
  FOR EACH ROW EXECUTE FUNCTION calibra_calibration_job_guard();
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
-- platform_event_log holds the public-signup reservation row, which
-- public-signup.ts updates when the signup completes and deletes when it fails.
-- Only that row (action public.signup.provisioned, details.status RESERVED) may
-- be changed; every other platform event is append-only.
DROP TRIGGER IF EXISTS platform_event_log_append_only ON public.platform_event_log;
CREATE TRIGGER platform_event_log_append_only
  BEFORE UPDATE OR DELETE ON public.platform_event_log
  FOR EACH ROW EXECUTE FUNCTION calibra_append_only('signup_reservation');
-- Records retention (migration 0117, decision Q16).
--
-- A LAB organization is never hard-deleted by accident:
--   * organization.retention_years is the retention period of the organization's
--     regulated records, never below 5 years;
--   * a soft-deleted organization (deleted_at) must be SUSPENDED, so the existing
--     tenant-lifecycle gate in requireOrganization locks everybody out;
--   * DELETE of a LAB organization raises unless the transaction opted in with
--     `SET LOCAL calibra.allow_org_purge = 'on'` (the records purge job, and the
--     cleanup of a just-created organization that holds no records) or with the
--     seed escape hatch `calibra.allow_audit_rewrite` of migration 0115. Both
--     are conventions for application code, not a security boundary.
--   * calibra_retain_until(org, record_date) is the date a record of that
--     organization may first be purged: record_date + retention_years.
ALTER TABLE organization DROP CONSTRAINT IF EXISTS organization_retention_years_min;
ALTER TABLE organization
  ADD CONSTRAINT organization_retention_years_min CHECK (retention_years >= 5);
ALTER TABLE organization DROP CONSTRAINT IF EXISTS organization_soft_delete_suspended;
ALTER TABLE organization
  ADD CONSTRAINT organization_soft_delete_suspended
  CHECK (deleted_at IS NULL OR status = 'SUSPENDED');
CREATE OR REPLACE FUNCTION calibra_org_purge_allowed()
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT calibra_history_rewrite_allowed()
      OR coalesce(current_setting('calibra.allow_org_purge', true), '') = 'on'
$$;
CREATE OR REPLACE FUNCTION calibra_organization_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF coalesce(OLD.type, 'LAB') <> 'LAB' OR calibra_org_purge_allowed() THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'organization % (%): a LAB organization cannot be hard-deleted',
    OLD.id, OLD.slug
    USING ERRCODE = 'P0001',
          TABLE = TG_TABLE_NAME,
          HINT = 'Soft-delete it (organization.deleted_at); only the records purge job removes the row, after the retention period.';
END
$$;
DROP TRIGGER IF EXISTS organization_lab_delete_guard ON public.organization;
CREATE TRIGGER organization_lab_delete_guard
  BEFORE DELETE ON public.organization
  FOR EACH ROW EXECUTE FUNCTION calibra_organization_delete_guard();
CREATE OR REPLACE FUNCTION calibra_retain_until(org_id text, record_date timestamp)
RETURNS timestamp
LANGUAGE sql STABLE
AS $$
  SELECT record_date + make_interval(
    years => coalesce(
      (SELECT o.retention_years FROM public.organization o WHERE o.id = org_id),
      10
    )
  )
$$;
