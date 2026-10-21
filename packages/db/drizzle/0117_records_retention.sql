-- Retention of regulated records (decision Q16): 10 years minimum for technical
-- records, certificates, audit and event logs, configurable per organization,
-- never below 5 years. docs/architecture/records-retention.md is the inventory.
--
--   1. organization gains the retention / soft-delete / legal-hold columns.
--   2. Every foreign key that cascaded a delete into evidence becomes RESTRICT
--      (the list below is checked against schema.ts by records-retention.test.ts):
--      deleting an organization, customer, asset, unit or reference standard that
--      still has records is refused instead of erasing them. Owned parts of an
--      evidence aggregate (an invoice line, a service-order attachment) keep their
--      cascade to their owner; SET NULL on actor columns stays.
--   3. The DELETE guard, the CHECKs and calibra_retain_until (shared with
--      sql/schema-extras.sql, which builds new databases).
--
-- Idempotent, because this project applies migration DDL by hand and the drizzle
-- bookkeeping table lags behind it. Constraint names are looked up, not
-- hard-coded: Postgres truncated them and they differ between databases built
-- from the migration chain and from schema.ts. Existing rows already satisfy
-- every foreign key, so re-adding them as RESTRICT cannot fail on existing data.
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "deleted_by" text;
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "deletion_reason" text;
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "retention_years" integer DEFAULT 10 NOT NULL;
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "legal_hold" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "legal_hold_reason" text;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = to_regclass('public.organization')
       AND conname = 'organization_deleted_by_user_id_fk'
  ) THEN
    ALTER TABLE "organization"
      ADD CONSTRAINT "organization_deleted_by_user_id_fk"
      FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  edge record;
  fk record;
BEGIN
  FOR edge IN
    SELECT child, col, parent
      FROM (VALUES
        ('asset_oot_event', 'asset_id', 'asset'),
        ('asset_oot_event', 'customer_id', 'customer'),
        ('asset_oot_event', 'job_id', 'calibration_job'),
        ('asset_oot_event', 'lab_organization_id', 'organization'),
        ('authorized_signatory', 'organization_id', 'organization'),
        ('billing_document', 'organization_id', 'organization'),
        ('billing_group', 'organization_id', 'organization'),
        ('billing_group_service_order', 'service_order_id', 'service_order'),
        ('calibration_job', 'organization_id', 'organization'),
        ('calibration_request', 'auth_organization_id', 'organization'),
        ('calibration_request', 'organization_id', 'organization'),
        ('calibration_visit', 'organization_id', 'organization'),
        ('certificate_numbering_sequence', 'organization_id', 'organization'),
        ('certificate_numbering_sequence', 'profile_id', 'certificate_numbering_profile'),
        ('certificate_release', 'organization_id', 'organization'),
        ('check_standard_reading', 'organization_id', 'organization'),
        ('check_standard_reading', 'standard_id', 'reference_standard'),
        ('commercial_agreement', 'customer_id', 'customer'),
        ('commercial_agreement', 'organization_id', 'organization'),
        ('control_chart', 'organization_id', 'organization'),
        ('control_chart', 'standard_id', 'reference_standard'),
        ('corrective_action', 'organization_id', 'organization'),
        ('issued_certificate_snapshot', 'organization_id', 'organization'),
        ('job_commercial_snapshot', 'organization_id', 'organization'),
        ('job_standard', 'standard_id', 'reference_standard'),
        ('non_conformance', 'organization_id', 'organization'),
        ('oot_impact_assessment', 'organization_id', 'organization'),
        ('oot_notification', 'organization_id', 'organization'),
        ('personnel_competence', 'organization_id', 'organization'),
        ('proficiency_test', 'organization_id', 'organization'),
        ('pt_plan_item', 'organization_id', 'organization'),
        ('reference_standard', 'organization_id', 'organization'),
        ('reference_standard_certificate_document', 'organization_id', 'organization'),
        ('reference_standard_certificate_document', 'standard_id', 'reference_standard'),
        ('service_order', 'organization_id', 'organization'),
        ('service_order_certificate_link', 'certificate_job_id', 'calibration_job'),
        ('service_order_numbering_sequence', 'organization_id', 'organization'),
        ('service_order_numbering_sequence', 'unit_id', 'organization_unit'),
        ('service_order_outsourced_cost', 'organization_id', 'organization'),
        ('standard_recall', 'organization_id', 'organization'),
        ('training_record', 'organization_id', 'organization'),
        ('visit_reschedule_request', 'organization_id', 'organization')
      ) AS v(child, col, parent)
  LOOP
    FOR fk IN
      SELECT c.conrelid::regclass AS tbl, c.conname, pg_get_constraintdef(c.oid) AS def
        FROM pg_constraint c
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
       WHERE c.contype = 'f'
         AND c.confdeltype = 'c'
         AND array_length(c.conkey, 1) = 1
         AND c.conrelid = to_regclass('public.' || edge.child)
         AND c.confrelid = to_regclass('public.' || edge.parent)
         AND a.attname = edge.col
    LOOP
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.tbl, fk.conname);
      EXECUTE format(
        'ALTER TABLE %s ADD CONSTRAINT %I %s',
        fk.tbl,
        fk.conname,
        replace(fk.def, 'ON DELETE CASCADE', 'ON DELETE RESTRICT')
      );
    END LOOP;
  END LOOP;
END
$$;
--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE organization
  ADD CONSTRAINT organization_retention_years_min CHECK (retention_years >= 5);
--> statement-breakpoint
ALTER TABLE organization DROP CONSTRAINT IF EXISTS organization_soft_delete_suspended;
--> statement-breakpoint
ALTER TABLE organization
  ADD CONSTRAINT organization_soft_delete_suspended
  CHECK (deleted_at IS NULL OR status = 'SUSPENDED');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION calibra_org_purge_allowed()
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT calibra_history_rewrite_allowed()
      OR coalesce(current_setting('calibra.allow_org_purge', true), '') = 'on'
$$;
--> statement-breakpoint
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
--> statement-breakpoint
DROP TRIGGER IF EXISTS organization_lab_delete_guard ON public.organization;
--> statement-breakpoint
CREATE TRIGGER organization_lab_delete_guard
  BEFORE DELETE ON public.organization
  FOR EACH ROW EXECUTE FUNCTION calibra_organization_delete_guard();
--> statement-breakpoint
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
