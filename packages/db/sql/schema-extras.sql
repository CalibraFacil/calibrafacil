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
-- `performed_at`, `approved_at`, ...), and the records purge erases an organization's
-- evidence. `SET LOCAL calibra.allow_audit_rewrite = 'on'` lifts every immutability
-- trigger below for the current transaction only (SET LOCAL reverts at
-- COMMIT/ROLLBACK), BUT ONLY FOR THE TABLE OWNER (migration 0130, roadmap 2 B1): the
-- setting alone is not enough, calibra_session_is_owner() must also be true, so a
-- calibra_app session that sets the GUC lifts nothing. The users are the owner
-- connection only (DATABASE_OWNER_URL / systemDb): apps/api/src/cli/seed-demo, the
-- records purge, an audited repair run by an operator, the test harness.
-- True when the session user AND the current user are the owner of the tables (or a
-- member of that role; a superuser is a member of every role). The session user is
-- checked too: a foreign-key action runs as the table owner inside an application
-- session, and must not open the hatch for it. The functions pin their search_path.
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
CREATE OR REPLACE FUNCTION calibra_history_rewrite_allowed()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT public.calibra_session_is_owner()
     AND coalesce(current_setting('calibra.allow_audit_rewrite', true), '') = 'on'
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
--     work for the table owner only (calibra_session_is_owner(), migration 0130):
--     the application role cannot lift the guard by setting them.
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
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT public.calibra_session_is_owner()
     AND (public.calibra_history_rewrite_allowed()
          OR coalesce(current_setting('calibra.allow_org_purge', true), '') = 'on')
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

-- Desktop sync change log (migration 0122, docs/architecture/sync-change-seq.md): the
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
  -- No entry for an organization that is going away: a hard delete of the organization
  -- removes its mirrored rows through ON DELETE CASCADE after the organization row is
  -- gone, and an entry for it would violate the foreign key (and be deleted anyway).
  INSERT INTO public.sync_change_log (organization_id, entity_type, entity_id, op, unit_id)
  SELECT p_organization_id, p_entity_type, p_entity_id, p_op, p_unit_id
  WHERE EXISTS (SELECT 1 FROM public.organization o WHERE o.id = p_organization_id)
    AND NOT EXISTS (
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
-- Row-level security of the tenant tables, SHADOW mode (migration 0123, roadmap P2-3).
-- Enabled, never FORCEd, policy TO calibra_app only: the table owner (every
-- deployment today) is exempt, so nothing changes until the API connects as a member
-- of calibra_app (DEPLOYMENT.md, "Row-level security"). The per-table block is
-- generated (`pnpm --filter @calibra-facil/db gen:rls-sql`); the drift guard
-- packages/db/src/rls-sql.test.ts keeps it equal to the migration and to the
-- tenancy classification.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'calibra_app') THEN
    BEGIN
      CREATE ROLE calibra_app NOLOGIN;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'calibra: the role calibra_app does not exist and % may not create it (CREATEROLE is missing). An administrator runs CREATE ROLE calibra_app NOLOGIN; once, then this migration is run again. See DEPLOYMENT.md, "Row-level security".', current_user
        USING ERRCODE = 'insufficient_privilege';
    END;
  END IF;
END
$$;
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO calibra_app', current_database());
END
$$;
GRANT USAGE ON SCHEMA public TO calibra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO calibra_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO calibra_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO calibra_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO calibra_app;
-- Evidence tables: no UPDATE/DELETE/TRUNCATE for the application role (migration 0130).
-- Must stay AFTER the blanket GRANT above.
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

-- BEGIN generated: calibra_rls_tenant_isolation
ALTER TABLE public."accredited_scope_line" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."accredited_scope_line";
CREATE POLICY tenant_isolation ON public."accredited_scope_line" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."accredited_scope_line_audit_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."accredited_scope_line_audit_log";
CREATE POLICY tenant_isolation ON public."accredited_scope_line_audit_log" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."asset" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."asset";
CREATE POLICY tenant_isolation ON public."asset" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("lab_organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("lab_organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."asset_audit_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."asset_audit_log";
CREATE POLICY tenant_isolation ON public."asset_audit_log" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."asset_oot_audit_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."asset_oot_audit_log";
CREATE POLICY tenant_isolation ON public."asset_oot_audit_log" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."asset_oot_event" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."asset_oot_event";
CREATE POLICY tenant_isolation ON public."asset_oot_event" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("lab_organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("lab_organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."asset_oot_impact_assessment" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."asset_oot_impact_assessment";
CREATE POLICY tenant_isolation ON public."asset_oot_impact_assessment" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."authorized_signatory" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."authorized_signatory";
CREATE POLICY tenant_isolation ON public."authorized_signatory" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."authorized_signatory_audit_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."authorized_signatory_audit_log";
CREATE POLICY tenant_isolation ON public."authorized_signatory_audit_log" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."automatic_send_audit_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."automatic_send_audit_log";
CREATE POLICY tenant_isolation ON public."automatic_send_audit_log" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."automatic_send_rule" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."automatic_send_rule";
CREATE POLICY tenant_isolation ON public."automatic_send_rule" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."billing_document" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."billing_document";
CREATE POLICY tenant_isolation ON public."billing_document" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."billing_document_item" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."billing_document_item";
CREATE POLICY tenant_isolation ON public."billing_document_item" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."billing_group" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."billing_group";
CREATE POLICY tenant_isolation ON public."billing_group" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."billing_group_service_order" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."billing_group_service_order";
CREATE POLICY tenant_isolation ON public."billing_group_service_order" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."calibration_job" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."calibration_job";
CREATE POLICY tenant_isolation ON public."calibration_job" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."calibration_method" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."calibration_method";
CREATE POLICY tenant_isolation ON public."calibration_method" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."calibration_request" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."calibration_request";
CREATE POLICY tenant_isolation ON public."calibration_request" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."calibration_request_audit_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."calibration_request_audit_log";
CREATE POLICY tenant_isolation ON public."calibration_request_audit_log" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."calibration_request_item" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."calibration_request_item";
CREATE POLICY tenant_isolation ON public."calibration_request_item" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."calibration_visit" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."calibration_visit";
CREATE POLICY tenant_isolation ON public."calibration_visit" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."certificate_input" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."certificate_input";
CREATE POLICY tenant_isolation ON public."certificate_input" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."certificate_numbering_audit_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."certificate_numbering_audit_log";
CREATE POLICY tenant_isolation ON public."certificate_numbering_audit_log" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."certificate_numbering_profile" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."certificate_numbering_profile";
CREATE POLICY tenant_isolation ON public."certificate_numbering_profile" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."certificate_numbering_sequence" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."certificate_numbering_sequence";
CREATE POLICY tenant_isolation ON public."certificate_numbering_sequence" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."certificate_release" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."certificate_release";
CREATE POLICY tenant_isolation ON public."certificate_release" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."certificate_release_audit_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."certificate_release_audit_log";
CREATE POLICY tenant_isolation ON public."certificate_release_audit_log" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."certificate_release_policy" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."certificate_release_policy";
CREATE POLICY tenant_isolation ON public."certificate_release_policy" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."check_standard_reading" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."check_standard_reading";
CREATE POLICY tenant_isolation ON public."check_standard_reading" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."commercial_agreement" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."commercial_agreement";
CREATE POLICY tenant_isolation ON public."commercial_agreement" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."commercial_agreement_service_term" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."commercial_agreement_service_term";
CREATE POLICY tenant_isolation ON public."commercial_agreement_service_term" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."commercial_agreement_unit_scope" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."commercial_agreement_unit_scope";
CREATE POLICY tenant_isolation ON public."commercial_agreement_unit_scope" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."control_chart" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."control_chart";
CREATE POLICY tenant_isolation ON public."control_chart" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."control_chart_audit_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."control_chart_audit_log";
CREATE POLICY tenant_isolation ON public."control_chart_audit_log" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."corrective_action" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."corrective_action";
CREATE POLICY tenant_isolation ON public."corrective_action" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."corrective_action_audit_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."corrective_action_audit_log";
CREATE POLICY tenant_isolation ON public."corrective_action_audit_log" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."customer" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."customer";
CREATE POLICY tenant_isolation ON public."customer" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("lab_organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("lab_organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."customer_audit_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."customer_audit_log";
CREATE POLICY tenant_isolation ON public."customer_audit_log" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."customer_group" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."customer_group";
CREATE POLICY tenant_isolation ON public."customer_group" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("lab_organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("lab_organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."environmental_limits" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."environmental_limits";
CREATE POLICY tenant_isolation ON public."environmental_limits" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."financial_audit_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."financial_audit_log";
CREATE POLICY tenant_isolation ON public."financial_audit_log" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."integration_connection" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."integration_connection";
CREATE POLICY tenant_isolation ON public."integration_connection" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."integration_event_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."integration_event_log";
CREATE POLICY tenant_isolation ON public."integration_event_log" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."integration_oauth_app" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."integration_oauth_app";
CREATE POLICY tenant_isolation ON public."integration_oauth_app" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."integration_object_link" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."integration_object_link";
CREATE POLICY tenant_isolation ON public."integration_object_link" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."integration_sync_cursor" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."integration_sync_cursor";
CREATE POLICY tenant_isolation ON public."integration_sync_cursor" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."integration_sync_item" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."integration_sync_item";
CREATE POLICY tenant_isolation ON public."integration_sync_item" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."integration_sync_run" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."integration_sync_run";
CREATE POLICY tenant_isolation ON public."integration_sync_run" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."invitation" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."invitation";
CREATE POLICY tenant_isolation ON public."invitation" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."issued_certificate_snapshot" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."issued_certificate_snapshot";
CREATE POLICY tenant_isolation ON public."issued_certificate_snapshot" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."job_audit_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."job_audit_log";
CREATE POLICY tenant_isolation ON public."job_audit_log" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."job_commercial_snapshot" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."job_commercial_snapshot";
CREATE POLICY tenant_isolation ON public."job_commercial_snapshot" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."job_standard" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."job_standard";
CREATE POLICY tenant_isolation ON public."job_standard" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."lab_account_setup_token" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."lab_account_setup_token";
CREATE POLICY tenant_isolation ON public."lab_account_setup_token" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."mass_composition_profile" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."mass_composition_profile";
CREATE POLICY tenant_isolation ON public."mass_composition_profile" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."material" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."material";
CREATE POLICY tenant_isolation ON public."material" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."member" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."member";
CREATE POLICY tenant_isolation ON public."member" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."member_unit_assignment" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."member_unit_assignment";
CREATE POLICY tenant_isolation ON public."member_unit_assignment" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."member_visual_signature" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."member_visual_signature";
CREATE POLICY tenant_isolation ON public."member_visual_signature" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."method_audit_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."method_audit_log";
CREATE POLICY tenant_isolation ON public."method_audit_log" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."non_conformance" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."non_conformance";
CREATE POLICY tenant_isolation ON public."non_conformance" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."non_conformance_audit_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."non_conformance_audit_log";
CREATE POLICY tenant_isolation ON public."non_conformance_audit_log" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."notification" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."notification";
CREATE POLICY tenant_isolation ON public."notification" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."oot_email_outbox" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."oot_email_outbox";
CREATE POLICY tenant_isolation ON public."oot_email_outbox" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."oot_impact_assessment" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."oot_impact_assessment";
CREATE POLICY tenant_isolation ON public."oot_impact_assessment" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."oot_notification" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."oot_notification";
CREATE POLICY tenant_isolation ON public."oot_notification" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."organization_api_key" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."organization_api_key";
CREATE POLICY tenant_isolation ON public."organization_api_key" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."organization_api_key_audit_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."organization_api_key_audit_log";
CREATE POLICY tenant_isolation ON public."organization_api_key_audit_log" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."organization_custom_domain" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."organization_custom_domain";
CREATE POLICY tenant_isolation ON public."organization_custom_domain" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."organization_email_domain" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."organization_email_domain";
CREATE POLICY tenant_isolation ON public."organization_email_domain" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."organization_event_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."organization_event_log";
CREATE POLICY tenant_isolation ON public."organization_event_log" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."organization_integration" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."organization_integration";
CREATE POLICY tenant_isolation ON public."organization_integration" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."organization_signing_certificate" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."organization_signing_certificate";
CREATE POLICY tenant_isolation ON public."organization_signing_certificate" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."organization_unit" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."organization_unit";
CREATE POLICY tenant_isolation ON public."organization_unit" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."payment_receipt" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."payment_receipt";
CREATE POLICY tenant_isolation ON public."payment_receipt" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."personnel_competence" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."personnel_competence";
CREATE POLICY tenant_isolation ON public."personnel_competence" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."personnel_competence_audit_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."personnel_competence_audit_log";
CREATE POLICY tenant_isolation ON public."personnel_competence_audit_log" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."portal_export_job" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."portal_export_job";
CREATE POLICY tenant_isolation ON public."portal_export_job" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("lab_organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("lab_organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."proficiency_test" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."proficiency_test";
CREATE POLICY tenant_isolation ON public."proficiency_test" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."proficiency_test_audit_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."proficiency_test_audit_log";
CREATE POLICY tenant_isolation ON public."proficiency_test_audit_log" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."pt_plan_item" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."pt_plan_item";
CREATE POLICY tenant_isolation ON public."pt_plan_item" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."public_api_idempotency_key" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."public_api_idempotency_key";
CREATE POLICY tenant_isolation ON public."public_api_idempotency_key" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."public_api_resource_ref" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."public_api_resource_ref";
CREATE POLICY tenant_isolation ON public."public_api_resource_ref" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."public_api_webhook_delivery" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."public_api_webhook_delivery";
CREATE POLICY tenant_isolation ON public."public_api_webhook_delivery" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."public_api_webhook_subscription" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."public_api_webhook_subscription";
CREATE POLICY tenant_isolation ON public."public_api_webhook_subscription" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."receivable_installment" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."receivable_installment";
CREATE POLICY tenant_isolation ON public."receivable_installment" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."reference_standard" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."reference_standard";
CREATE POLICY tenant_isolation ON public."reference_standard" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."reference_standard_audit_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."reference_standard_audit_log";
CREATE POLICY tenant_isolation ON public."reference_standard_audit_log" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."reference_standard_certificate_document" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."reference_standard_certificate_document";
CREATE POLICY tenant_isolation ON public."reference_standard_certificate_document" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."scheduled_notification" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."scheduled_notification";
CREATE POLICY tenant_isolation ON public."scheduled_notification" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."service" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."service";
CREATE POLICY tenant_isolation ON public."service" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."service_audit_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."service_audit_log";
CREATE POLICY tenant_isolation ON public."service_audit_log" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."service_order" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."service_order";
CREATE POLICY tenant_isolation ON public."service_order" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."service_order_asset_snapshot" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."service_order_asset_snapshot";
CREATE POLICY tenant_isolation ON public."service_order_asset_snapshot" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."service_order_attachment" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."service_order_attachment";
CREATE POLICY tenant_isolation ON public."service_order_attachment" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."service_order_certificate_link" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."service_order_certificate_link";
CREATE POLICY tenant_isolation ON public."service_order_certificate_link" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."service_order_delivery_document" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."service_order_delivery_document";
CREATE POLICY tenant_isolation ON public."service_order_delivery_document" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."service_order_email_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."service_order_email_log";
CREATE POLICY tenant_isolation ON public."service_order_email_log" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."service_order_email_outbox" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."service_order_email_outbox";
CREATE POLICY tenant_isolation ON public."service_order_email_outbox" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."service_order_evaluation" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."service_order_evaluation";
CREATE POLICY tenant_isolation ON public."service_order_evaluation" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."service_order_event_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."service_order_event_log";
CREATE POLICY tenant_isolation ON public."service_order_event_log" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."service_order_execution" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."service_order_execution";
CREATE POLICY tenant_isolation ON public."service_order_execution" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."service_order_execution_item" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."service_order_execution_item";
CREATE POLICY tenant_isolation ON public."service_order_execution_item" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."service_order_intake_document" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."service_order_intake_document";
CREATE POLICY tenant_isolation ON public."service_order_intake_document" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."service_order_numbering_sequence" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."service_order_numbering_sequence";
CREATE POLICY tenant_isolation ON public."service_order_numbering_sequence" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."service_order_outsourced_cost" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."service_order_outsourced_cost";
CREATE POLICY tenant_isolation ON public."service_order_outsourced_cost" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."service_order_public_access_token" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."service_order_public_access_token";
CREATE POLICY tenant_isolation ON public."service_order_public_access_token" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."service_order_quote" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."service_order_quote";
CREATE POLICY tenant_isolation ON public."service_order_quote" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."service_order_quote_item" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."service_order_quote_item";
CREATE POLICY tenant_isolation ON public."service_order_quote_item" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."service_order_settings" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."service_order_settings";
CREATE POLICY tenant_isolation ON public."service_order_settings" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."service_order_tag" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."service_order_tag";
CREATE POLICY tenant_isolation ON public."service_order_tag" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."sso_provider" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."sso_provider";
CREATE POLICY tenant_isolation ON public."sso_provider" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."standard_recall" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."standard_recall";
CREATE POLICY tenant_isolation ON public."standard_recall" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."supplier" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."supplier";
CREATE POLICY tenant_isolation ON public."supplier" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."sync_applied_event" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."sync_applied_event";
CREATE POLICY tenant_isolation ON public."sync_applied_event" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."sync_change_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."sync_change_log";
CREATE POLICY tenant_isolation ON public."sync_change_log" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."sync_change_log_purge" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."sync_change_log_purge";
CREATE POLICY tenant_isolation ON public."sync_change_log_purge" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."training_record" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."training_record";
CREATE POLICY tenant_isolation ON public."training_record" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."training_record_audit_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."training_record_audit_log";
CREATE POLICY tenant_isolation ON public."training_record_audit_log" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."visit_audit_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."visit_audit_log";
CREATE POLICY tenant_isolation ON public."visit_audit_log" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
ALTER TABLE public."visit_reschedule_request" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."visit_reschedule_request";
CREATE POLICY tenant_isolation ON public."visit_reschedule_request" AS PERMISSIVE FOR ALL TO calibra_app
  USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)
  WITH CHECK ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text);
-- END generated: calibra_rls_tenant_isolation

-- Hash chain of job_audit_log (migration 0131, roadmap 2 B1): tamper evidence, per organization.
-- The columns and the unique index are in schema.ts; the functions and the trigger cannot be
-- expressed there. Repeated verbatim from the migration between the BEGIN/END markers;
-- packages/db/src/audit-chain-sql.test.ts fails when they differ.
-- BEGIN audit hash chain functions (migration 0131)
-- The columns a chained table's hash covers, in no particular order (the canonical
-- text sorts them). A column NOT listed is not covered: that is how the foreign-key
-- ON DELETE SET NULL columns of an event log (rewritten by Postgres when a user or
-- unit is deleted) stay out of a chain, and how a column added later stays out until
-- a migration adds it here. Adding a table to the chain: list it here, add a column
-- set (chain_seq bigint, prev_hash bytea, row_hash bytea), a unique index on
-- (organization_id, chain_seq) and the BEFORE INSERT trigger below.
CREATE OR REPLACE FUNCTION calibra_audit_chain_columns(p_table text)
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE p_table
    WHEN 'job_audit_log' THEN ARRAY[
      'id', 'organization_id', 'job_id', 'action', 'changes',
      'performed_by', 'performed_at', 'ip_address', 'reason'
    ]
  END
$$;
-- The canonical text of a row: a jsonb object of the covered columns that are not NULL
-- (jsonb text is deterministic: keys sorted, one spacing). A NULL column and an absent
-- one hash the same, so a column that a later migration adds to the list does not
-- change the hash of the rows written before it.
CREATE OR REPLACE FUNCTION calibra_audit_chain_content(p_table text, p_row jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT coalesce(
           jsonb_object_agg(c.k, p_row -> c.k)
             FILTER (WHERE p_row -> c.k IS NOT NULL AND p_row -> c.k <> 'null'::jsonb),
           '{}'::jsonb
         )::text
    FROM unnest(public.calibra_audit_chain_columns(p_table)) AS c(k)
$$;
-- row_hash = sha256(prev_hash || table || LF || chain_seq || LF || canonical row). The first
-- link of a chain has no prev_hash (NULL, hashed as the empty string).
CREATE OR REPLACE FUNCTION calibra_audit_chain_hash(
  p_table text, p_seq bigint, p_prev bytea, p_row jsonb
)
RETURNS bytea
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT sha256(
    coalesce(p_prev, '\x'::bytea)
    || convert_to(
         p_table || E'\n' || p_seq::text || E'\n' || public.calibra_audit_chain_content(p_table, p_row),
         'UTF8')
  )
$$;
-- BEFORE INSERT trigger: links the new row to the head of its organization's chain.
--
-- Serialisation. The head is "the row with the highest chain_seq of this organization", so two
-- transactions must not read it at the same time: each takes
-- pg_advisory_xact_lock(hashtextextended('<table>:<organization>', 7041)) first and keeps it to
-- COMMIT or ROLLBACK, so the next writer reads the head the previous one left (READ COMMITTED:
-- the head SELECT is a new statement, after the lock). One bigint key per (table, organization),
-- a keyspace apart from the two-int advisory locks of the application (certificate and billing
-- numbering) and from its hashtextextended(..., 0) lock; it is never held while waiting for
-- another advisory lock. Cost: transactions that write an audit row for the same organization run
-- one after the other from their first audit insert on; a transaction that takes a row lock AFTER
-- its first audit insert while another takes it BEFORE can deadlock (Postgres detects it, 40P01,
-- and aborts one), so write the audit row last. Under REPEATABLE READ or SERIALIZABLE the head
-- read can be stale; the unique index on (organization_id, chain_seq) then refuses the fork (23505)
-- instead of letting it happen.
-- Whatever chain_seq, prev_hash or row_hash an insert carries is overwritten: the application
-- cannot choose its place in the chain. A row without an organization (an orphan of migration
-- 0118) is left unchained.
CREATE OR REPLACE FUNCTION calibra_audit_chain_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_head_seq bigint;
  v_head_hash bytea;
BEGIN
  IF NEW.organization_id IS NULL THEN
    NEW.chain_seq := NULL;
    NEW.prev_hash := NULL;
    NEW.row_hash := NULL;
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(TG_TABLE_NAME || ':' || NEW.organization_id, 7041));

  EXECUTE format(
    'SELECT t.chain_seq, t.row_hash FROM %I.%I t
      WHERE t.organization_id = $1 AND t.chain_seq IS NOT NULL
      ORDER BY t.chain_seq DESC LIMIT 1',
    TG_TABLE_SCHEMA, TG_TABLE_NAME)
    INTO v_head_seq, v_head_hash
    USING NEW.organization_id;

  NEW.chain_seq := coalesce(v_head_seq, 0) + 1;
  NEW.prev_hash := v_head_hash;
  NEW.row_hash := public.calibra_audit_chain_hash(
    TG_TABLE_NAME, NEW.chain_seq, NEW.prev_hash, to_jsonb(NEW));
  RETURN NEW;
END
$$;
-- The head of an organization's chain: its last link and the number of links. No row when the
-- organization has none.
CREATE OR REPLACE FUNCTION calibra_audit_chain_head(p_table text, p_org text)
RETURNS TABLE (out_chain_seq bigint, out_row_hash bytea, out_links bigint)
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF public.calibra_audit_chain_columns(p_table) IS NULL THEN
    RAISE EXCEPTION 'calibra: % is not a chained table', p_table;
  END IF;
  RETURN QUERY EXECUTE format(
    'SELECT t.chain_seq, t.row_hash,
            (SELECT count(*) FROM public.%1$I c WHERE c.organization_id = $1 AND c.chain_seq IS NOT NULL)
       FROM public.%1$I t
      WHERE t.organization_id = $1 AND t.chain_seq IS NOT NULL
      ORDER BY t.chain_seq DESC LIMIT 1', p_table)
    USING p_org;
END
$$;
-- The row_hash of one link, or NULL when the organization has no such link: what a checkpoint
-- (the head some earlier verification recorded) is compared with, so a deletion of the TAIL of a
-- chain, which the chain itself cannot show, is caught by the next run.
CREATE OR REPLACE FUNCTION calibra_audit_chain_link_hash(p_table text, p_org text, p_seq bigint)
RETURNS bytea
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_hash bytea;
BEGIN
  IF public.calibra_audit_chain_columns(p_table) IS NULL THEN
    RAISE EXCEPTION 'calibra: % is not a chained table', p_table;
  END IF;
  EXECUTE format(
    'SELECT t.row_hash FROM public.%I t WHERE t.organization_id = $1 AND t.chain_seq = $2', p_table)
    INTO v_hash
    USING p_org, p_seq;
  RETURN v_hash;
END
$$;
-- Recomputes an organization's chain and returns its FIRST break (no row = intact):
--   sequence_gap        the link is not the one after its predecessor (a link was deleted, or the
--                       first one is not 1)
--   prev_hash_mismatch  prev_hash is not the predecessor's row_hash
--   row_hash_mismatch   the stored content does not hash to row_hash (a row was edited)
--   unchained_row       a row of the organization that never got a link (trigger bypassed)
-- out_row_id names the row to look at (for a gap, the first row after the hole). Read-only.
CREATE OR REPLACE FUNCTION calibra_audit_chain_verify(p_table text, p_org text)
RETURNS TABLE (
  out_row_id integer,
  out_chain_seq bigint,
  out_kind text,
  out_expected bytea,
  out_actual bytea
)
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF public.calibra_audit_chain_columns(p_table) IS NULL THEN
    RAISE EXCEPTION 'calibra: % is not a chained table', p_table;
  END IF;
  RETURN QUERY EXECUTE format(
    'WITH chained AS (
       SELECT t.id AS row_id, t.chain_seq AS seq, t.prev_hash, t.row_hash,
              lag(t.chain_seq) OVER w AS lag_seq,
              lag(t.row_hash) OVER w AS lag_hash,
              public.calibra_audit_chain_hash(%2$L, t.chain_seq, t.prev_hash, to_jsonb(t)) AS recomputed
         FROM public.%1$I t
        WHERE t.organization_id = $1 AND t.chain_seq IS NOT NULL
       WINDOW w AS (ORDER BY t.chain_seq)
     ), breaks AS (
       SELECT c.row_id, c.seq,
              CASE
                WHEN c.seq IS DISTINCT FROM coalesce(c.lag_seq, 0) + 1 THEN ''sequence_gap''
                WHEN c.prev_hash IS DISTINCT FROM c.lag_hash THEN ''prev_hash_mismatch''
                WHEN c.row_hash IS DISTINCT FROM c.recomputed THEN ''row_hash_mismatch''
              END AS kind,
              CASE
                WHEN c.seq IS DISTINCT FROM coalesce(c.lag_seq, 0) + 1 THEN NULL
                WHEN c.prev_hash IS DISTINCT FROM c.lag_hash THEN c.lag_hash
                ELSE c.recomputed
              END AS expected,
              CASE
                WHEN c.seq IS DISTINCT FROM coalesce(c.lag_seq, 0) + 1 THEN NULL
                WHEN c.prev_hash IS DISTINCT FROM c.lag_hash THEN c.prev_hash
                ELSE c.row_hash
              END AS actual
         FROM chained c
     )
     SELECT b.row_id, b.seq, b.kind, b.expected, b.actual FROM breaks b WHERE b.kind IS NOT NULL
     UNION ALL
     SELECT min(u.id), NULL::bigint, ''unchained_row'', NULL::bytea, NULL::bytea
       FROM public.%1$I u
      WHERE u.organization_id = $1 AND u.chain_seq IS NULL
     HAVING count(*) > 0
     ORDER BY 2 NULLS LAST
     LIMIT 1', p_table, p_table)
    USING p_org;
END
$$;
-- Links the rows of a chained table that have no link yet (a table that existed before its chain,
-- or rows written with the trigger disabled), per organization, in id order, after the current
-- head. With p_rebuild the organization's links are dropped first and the whole chain is
-- recomputed in id order: for the demo seed, which back-dates audit rows on purpose, and for an
-- audited repair; it deliberately rewrites history, which is why it is owner-only (the append-only
-- trigger yields to calibra.allow_audit_rewrite for the table owner, set here for the call).
-- Returns the number of links written. p_org NULL = every organization.
CREATE OR REPLACE FUNCTION calibra_audit_chain_backfill(
  p_table text, p_org text DEFAULT NULL, p_rebuild boolean DEFAULT false
)
RETURNS bigint
LANGUAGE plpgsql
-- public stays on the path: the UPDATEs below fire the append-only trigger, whose own
-- unqualified calls (calibra_history_rewrite_allowed) resolve under this function's setting.
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org record;
  v_row record;
  v_seq bigint;
  v_prev bytea;
  v_hash bytea;
  v_total bigint := 0;
  v_was text := coalesce(current_setting('calibra.allow_audit_rewrite', true), '');
BEGIN
  IF NOT public.calibra_session_is_owner() THEN
    RAISE EXCEPTION 'calibra: the audit chain can be (re)built by the table owner only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF public.calibra_audit_chain_columns(p_table) IS NULL THEN
    RAISE EXCEPTION 'calibra: % is not a chained table', p_table;
  END IF;

  PERFORM set_config('calibra.allow_audit_rewrite', 'on', true);

  IF p_rebuild THEN
    EXECUTE format(
      'UPDATE public.%I SET chain_seq = NULL, prev_hash = NULL, row_hash = NULL
        WHERE organization_id IS NOT NULL AND ($1 IS NULL OR organization_id = $1)
          AND chain_seq IS NOT NULL', p_table)
      USING p_org;
  END IF;

  FOR v_org IN EXECUTE format(
    'SELECT DISTINCT organization_id AS id FROM public.%I
      WHERE organization_id IS NOT NULL AND chain_seq IS NULL
        AND ($1 IS NULL OR organization_id = $1)
      ORDER BY 1', p_table)
    USING p_org
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(p_table || ':' || v_org.id, 7041));
    v_seq := NULL;
    v_prev := NULL;
    EXECUTE format(
      'SELECT t.chain_seq, t.row_hash FROM public.%I t
        WHERE t.organization_id = $1 AND t.chain_seq IS NOT NULL
        ORDER BY t.chain_seq DESC LIMIT 1', p_table)
      INTO v_seq, v_prev
      USING v_org.id;
    v_seq := coalesce(v_seq, 0);

    FOR v_row IN EXECUTE format(
      'SELECT t.id, to_jsonb(t) AS j FROM public.%I t
        WHERE t.organization_id = $1 AND t.chain_seq IS NULL
        ORDER BY t.id', p_table)
      USING v_org.id
    LOOP
      v_seq := v_seq + 1;
      v_hash := public.calibra_audit_chain_hash(p_table, v_seq, v_prev, v_row.j);
      EXECUTE format(
        'UPDATE public.%I SET chain_seq = $1, prev_hash = $2, row_hash = $3 WHERE id = $4', p_table)
        USING v_seq, v_prev, v_hash, v_row.id;
      v_prev := v_hash;
      v_total := v_total + 1;
    END LOOP;
  END LOOP;

  PERFORM set_config('calibra.allow_audit_rewrite', v_was, true);
  RETURN v_total;
END
$$;
-- END audit hash chain functions (migration 0131)
CREATE UNIQUE INDEX IF NOT EXISTS job_audit_log_org_chain_seq_uidx
  ON public.job_audit_log USING btree (organization_id, chain_seq);
DROP TRIGGER IF EXISTS job_audit_log_hash_chain ON public.job_audit_log;
CREATE TRIGGER job_audit_log_hash_chain
  BEFORE INSERT ON public.job_audit_log
  FOR EACH ROW EXECUTE FUNCTION calibra_audit_chain_before_insert();
