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
-- Organization on every audit log (migration 0118, docs/architecture/tenancy.md).
-- The audit logs outlive the entity they document, so rows written before the column
-- existed may stay without an organization: the column is nullable and this CHECK is
-- NOT VALID, which refuses every NEW row without one while tolerating legacy orphans
-- (VALIDATE CONSTRAINT works once they are attributed or archived).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'asset_audit_log',
    'asset_oot_audit_log',
    'authorized_signatory_audit_log',
    'calibration_request_audit_log',
    'control_chart_audit_log',
    'corrective_action_audit_log',
    'customer_audit_log',
    'job_audit_log',
    'method_audit_log',
    'non_conformance_audit_log',
    'personnel_competence_audit_log',
    'proficiency_test_audit_log',
    'reference_standard_audit_log',
    'service_audit_log',
    'training_record_audit_log',
    'visit_audit_log'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = to_regclass(format('public.%I', t))
         AND conname = left(t || '_organization_id_required', 63)
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (organization_id IS NOT NULL) NOT VALID',
        t, left(t || '_organization_id_required', 63));
    END IF;
  END LOOP;
END
$$;

-- calibration_job status machine, enforced in Postgres (migration 0119, roadmap P2-6).
-- The function is generated from packages/schemas/src/job-transitions.ts
-- (`pnpm --filter @calibra-facil/db gen:job-transitions-sql`); the drift guard
-- packages/db/src/job-transitions-sql.test.ts keeps it equal to the migration.
-- Audited repairs: `SET LOCAL calibra.allow_status_repair = 'on'` in a transaction.
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
DROP TRIGGER IF EXISTS calibration_job_status_transition_guard ON public.calibration_job;
CREATE TRIGGER calibration_job_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.calibration_job
  FOR EACH ROW EXECUTE FUNCTION calibra_calibration_job_status_guard();
-- certificate_input guard (migration 0120): the frozen input never changes. UPDATE is
-- always refused. DELETE is allowed only while the job is in REVIEW: the approval that
-- wrote the row did not complete (dispatch failed and was reverted, or the job was
-- rejected and is approved again), so the row documents nothing that was released. The
-- seed / purge escape hatch (calibra.allow_audit_rewrite) lifts both for one transaction.
CREATE OR REPLACE FUNCTION calibra_certificate_input_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  job_status text;
BEGIN
  IF calibra_history_rewrite_allowed() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT status INTO job_status FROM public.calibration_job WHERE id = OLD.job_id;
    IF job_status = 'REVIEW' THEN
      RETURN OLD;
    END IF;
  END IF;

  RAISE EXCEPTION 'certificate_input row % (job %): the frozen certificate input is immutable: % is not allowed',
    OLD.id, OLD.job_id, TG_OP
    USING ERRCODE = 'P0001',
          TABLE = TG_TABLE_NAME,
          HINT = 'The input of an approved certificate is frozen; amend the job instead of editing it.';
END
$$;
DROP TRIGGER IF EXISTS certificate_input_immutable_guard ON public.certificate_input;
CREATE TRIGGER certificate_input_immutable_guard
  BEFORE UPDATE OR DELETE ON public.certificate_input
  FOR EACH ROW EXECUTE FUNCTION calibra_certificate_input_guard();

-- Desktop sync change log (migration 0121, docs/architecture/sync-change-seq.md): the
-- append function, the trigger body and the triggers on every table the desktop
-- mirrors. Repeated from the migration verbatim between the BEGIN/END markers;
-- packages/db/src/sync-change-log-sql.test.ts fails when they differ.
-- BEGIN sync change log functions
CREATE OR REPLACE FUNCTION calibra_sync_change_log_append(
  p_organization_id text,
  p_entity_type text,
  p_entity_id integer,
  p_op text,
  p_unit_id integer
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_organization_id IS NULL OR p_entity_id IS NULL THEN
    RETURN;
  END IF;
  -- One entry per (entity, op, unit) per transaction: a transaction that touches a
  -- row five times is one change to the desktop.
  INSERT INTO public.sync_change_log (organization_id, entity_type, entity_id, op, unit_id)
  SELECT p_organization_id, p_entity_type, p_entity_id, p_op, p_unit_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.sync_change_log existing
    WHERE existing.organization_id = p_organization_id
      AND existing.xid = pg_current_xact_id()
      AND existing.entity_type = p_entity_type
      AND existing.entity_id = p_entity_id
      AND existing.op = p_op
      AND existing.unit_id IS NOT DISTINCT FROM p_unit_id
  );
END
$$;

-- The trigger body. TG_ARGV[0] is the entity type the desktop knows the table as.
-- Which column names the laboratory and the unit differs by table, so they are read
-- by table name; a branch for another table is never executed, so never planned.
CREATE OR REPLACE FUNCTION calibra_sync_change_log()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_entity text := TG_ARGV[0];
  v_old_org text;
  v_new_org text;
  v_old_unit integer;
  v_new_unit integer;
  v_old_id integer;
  v_new_id integer;
  v_old_visible boolean := true;
  v_new_visible boolean := true;
BEGIN
  IF TG_TABLE_NAME = 'asset_type' THEN
    -- A global catalog: every laboratory mirrors it, so the change is logged once for each.
    IF TG_OP = 'DELETE' THEN
      v_new_id := OLD.id;
    ELSE
      v_new_id := NEW.id;
    END IF;
    INSERT INTO public.sync_change_log (organization_id, entity_type, entity_id, op, unit_id)
    SELECT o.id, v_entity, v_new_id, CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END, NULL
    FROM public.organization o
    WHERE coalesce(o.type, 'LAB') = 'LAB'
      AND NOT EXISTS (
        SELECT 1 FROM public.sync_change_log existing
        WHERE existing.organization_id = o.id
          AND existing.xid = pg_current_xact_id()
          AND existing.entity_type = v_entity
          AND existing.entity_id = v_new_id
          AND existing.op = CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END
      );
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    CASE TG_TABLE_NAME
      WHEN 'customer' THEN
        v_old_org := OLD.lab_organization_id; v_old_id := OLD.id;
      WHEN 'asset' THEN
        v_old_org := OLD.lab_organization_id; v_old_unit := OLD.unit_id; v_old_id := OLD.id;
      WHEN 'calibration_method' THEN
        v_old_org := OLD.organization_id; v_old_id := OLD.id;
        v_old_visible := OLD.status = 'PUBLISHED';
      WHEN 'mass_composition_profile' THEN
        v_old_org := OLD.organization_id; v_old_id := OLD.id;
      WHEN 'reference_standard_certificate_document' THEN
        v_old_org := OLD.organization_id; v_old_unit := OLD.unit_id; v_old_id := OLD.standard_id;
      ELSE
        v_old_org := OLD.organization_id; v_old_unit := OLD.unit_id; v_old_id := OLD.id;
    END CASE;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    CASE TG_TABLE_NAME
      WHEN 'customer' THEN
        v_new_org := NEW.lab_organization_id; v_new_id := NEW.id;
      WHEN 'asset' THEN
        v_new_org := NEW.lab_organization_id; v_new_unit := NEW.unit_id; v_new_id := NEW.id;
      WHEN 'calibration_method' THEN
        v_new_org := NEW.organization_id; v_new_id := NEW.id;
        v_new_visible := NEW.status = 'PUBLISHED';
      WHEN 'mass_composition_profile' THEN
        v_new_org := NEW.organization_id; v_new_id := NEW.id;
      WHEN 'reference_standard_certificate_document' THEN
        v_new_org := NEW.organization_id; v_new_unit := NEW.unit_id; v_new_id := NEW.standard_id;
      ELSE
        v_new_org := NEW.organization_id; v_new_unit := NEW.unit_id; v_new_id := NEW.id;
    END CASE;
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- A document of a standard changed the standard, it did not make it disappear.
    IF TG_TABLE_NAME = 'reference_standard_certificate_document' THEN
      PERFORM calibra_sync_change_log_append(v_old_org, v_entity, v_old_id, 'upsert', v_old_unit);
    ELSIF v_old_visible THEN
      PERFORM calibra_sync_change_log_append(v_old_org, v_entity, v_old_id, 'delete', v_old_unit);
    END IF;
    RETURN NULL;
  END IF;

  -- INSERT and UPDATE. What the desktop gets is decided when it pulls (an entry only
  -- says "look at this row again, in this unit"), so a row that left a scope (another
  -- unit, no longer published) needs an entry for the scope it left.
  IF v_new_visible THEN
    PERFORM calibra_sync_change_log_append(v_new_org, v_entity, v_new_id, 'upsert', v_new_unit);
  END IF;
  IF TG_OP = 'UPDATE'
     AND v_old_visible
     AND (v_old_org IS DISTINCT FROM v_new_org
          OR v_old_unit IS DISTINCT FROM v_new_unit
          OR v_old_id IS DISTINCT FROM v_new_id
          OR NOT v_new_visible) THEN
    PERFORM calibra_sync_change_log_append(v_old_org, v_entity, v_old_id, 'delete', v_old_unit);
  END IF;
  RETURN NULL;
END
$$;
-- END sync change log functions
-- BEGIN sync change log triggers
DROP TRIGGER IF EXISTS sync_change_log_asset_type_write ON public.asset_type;
CREATE TRIGGER sync_change_log_asset_type_write
  AFTER INSERT OR DELETE ON public.asset_type
  FOR EACH ROW EXECUTE FUNCTION calibra_sync_change_log('asset_type');
DROP TRIGGER IF EXISTS sync_change_log_asset_type_update ON public.asset_type;
CREATE TRIGGER sync_change_log_asset_type_update
  AFTER UPDATE ON public.asset_type
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION calibra_sync_change_log('asset_type');
DROP TRIGGER IF EXISTS sync_change_log_customer_write ON public.customer;
CREATE TRIGGER sync_change_log_customer_write
  AFTER INSERT OR DELETE ON public.customer
  FOR EACH ROW EXECUTE FUNCTION calibra_sync_change_log('customer');
DROP TRIGGER IF EXISTS sync_change_log_customer_update ON public.customer;
CREATE TRIGGER sync_change_log_customer_update
  AFTER UPDATE ON public.customer
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION calibra_sync_change_log('customer');
DROP TRIGGER IF EXISTS sync_change_log_asset_write ON public.asset;
CREATE TRIGGER sync_change_log_asset_write
  AFTER INSERT OR DELETE ON public.asset
  FOR EACH ROW EXECUTE FUNCTION calibra_sync_change_log('asset');
DROP TRIGGER IF EXISTS sync_change_log_asset_update ON public.asset;
CREATE TRIGGER sync_change_log_asset_update
  AFTER UPDATE ON public.asset
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION calibra_sync_change_log('asset');
DROP TRIGGER IF EXISTS sync_change_log_service_write ON public.service;
CREATE TRIGGER sync_change_log_service_write
  AFTER INSERT OR DELETE ON public.service
  FOR EACH ROW EXECUTE FUNCTION calibra_sync_change_log('service');
DROP TRIGGER IF EXISTS sync_change_log_service_update ON public.service;
CREATE TRIGGER sync_change_log_service_update
  AFTER UPDATE ON public.service
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION calibra_sync_change_log('service');
DROP TRIGGER IF EXISTS sync_change_log_reference_standard_write ON public.reference_standard;
CREATE TRIGGER sync_change_log_reference_standard_write
  AFTER INSERT OR DELETE ON public.reference_standard
  FOR EACH ROW EXECUTE FUNCTION calibra_sync_change_log('reference_standard');
DROP TRIGGER IF EXISTS sync_change_log_reference_standard_update ON public.reference_standard;
CREATE TRIGGER sync_change_log_reference_standard_update
  AFTER UPDATE ON public.reference_standard
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION calibra_sync_change_log('reference_standard');
DROP TRIGGER IF EXISTS sync_change_log_reference_standard_certificate_document_write ON public.reference_standard_certificate_document;
CREATE TRIGGER sync_change_log_reference_standard_certificate_document_write
  AFTER INSERT OR DELETE ON public.reference_standard_certificate_document
  FOR EACH ROW EXECUTE FUNCTION calibra_sync_change_log('reference_standard');
DROP TRIGGER IF EXISTS sync_change_log_reference_standard_certificate_document_update ON public.reference_standard_certificate_document;
CREATE TRIGGER sync_change_log_reference_standard_certificate_document_update
  AFTER UPDATE ON public.reference_standard_certificate_document
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION calibra_sync_change_log('reference_standard');
DROP TRIGGER IF EXISTS sync_change_log_environmental_limits_write ON public.environmental_limits;
CREATE TRIGGER sync_change_log_environmental_limits_write
  AFTER INSERT OR DELETE ON public.environmental_limits
  FOR EACH ROW EXECUTE FUNCTION calibra_sync_change_log('environmental_limit');
DROP TRIGGER IF EXISTS sync_change_log_environmental_limits_update ON public.environmental_limits;
CREATE TRIGGER sync_change_log_environmental_limits_update
  AFTER UPDATE ON public.environmental_limits
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION calibra_sync_change_log('environmental_limit');
DROP TRIGGER IF EXISTS sync_change_log_calibration_job_write ON public.calibration_job;
CREATE TRIGGER sync_change_log_calibration_job_write
  AFTER INSERT OR DELETE ON public.calibration_job
  FOR EACH ROW EXECUTE FUNCTION calibra_sync_change_log('calibration_job');
DROP TRIGGER IF EXISTS sync_change_log_calibration_job_update ON public.calibration_job;
CREATE TRIGGER sync_change_log_calibration_job_update
  AFTER UPDATE ON public.calibration_job
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION calibra_sync_change_log('calibration_job');
DROP TRIGGER IF EXISTS sync_change_log_service_order_write ON public.service_order;
CREATE TRIGGER sync_change_log_service_order_write
  AFTER INSERT OR DELETE ON public.service_order
  FOR EACH ROW EXECUTE FUNCTION calibra_sync_change_log('service_order');
DROP TRIGGER IF EXISTS sync_change_log_service_order_update ON public.service_order;
CREATE TRIGGER sync_change_log_service_order_update
  AFTER UPDATE ON public.service_order
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION calibra_sync_change_log('service_order');
DROP TRIGGER IF EXISTS sync_change_log_calibration_method_write ON public.calibration_method;
CREATE TRIGGER sync_change_log_calibration_method_write
  AFTER INSERT OR DELETE ON public.calibration_method
  FOR EACH ROW EXECUTE FUNCTION calibra_sync_change_log('published_method');
DROP TRIGGER IF EXISTS sync_change_log_calibration_method_update ON public.calibration_method;
CREATE TRIGGER sync_change_log_calibration_method_update
  AFTER UPDATE ON public.calibration_method
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION calibra_sync_change_log('published_method');
DROP TRIGGER IF EXISTS sync_change_log_mass_composition_profile_write ON public.mass_composition_profile;
CREATE TRIGGER sync_change_log_mass_composition_profile_write
  AFTER INSERT OR DELETE ON public.mass_composition_profile
  FOR EACH ROW EXECUTE FUNCTION calibra_sync_change_log('mass_composition_profile');
DROP TRIGGER IF EXISTS sync_change_log_mass_composition_profile_update ON public.mass_composition_profile;
CREATE TRIGGER sync_change_log_mass_composition_profile_update
  AFTER UPDATE ON public.mass_composition_profile
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION calibra_sync_change_log('mass_composition_profile');
-- END sync change log triggers
