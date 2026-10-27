-- Signing-credential custody and the compliance audit log (roadmap 2 B4a, Q44; review 3.1).
--
-- 1. organization_signing_certificate gets `kek_id` and `custody_format_version`:
--    1 = the legacy storage (P12 and password encrypted straight with the master key,
--    `kek_id` NULL), 2 = the envelope (a random data key per field, wrapped by the KEK
--    named by `kek_id`; AAD = organization + unit + serial). EVERY EXISTING ROW STAYS
--    AT 1 AND KEEPS DECRYPTING: the default is 1, nothing is rewritten here. The CLI
--    `reencrypt-signing-credentials` (apps/api) migrates the rows. A CHECK keeps the
--    two columns in step.
--
-- 2. organization_compliance_audit_log: append-only audit of the signing credentials,
--    the "emitir sem assinatura" switch, the signing policy and the accreditation
--    profile. Same pattern as the other *_audit_log tables (organization_id is a soft
--    reference, so the row outlives its organization), plus:
--      * the calibra_append_only trigger (UPDATE/DELETE raise);
--      * ROW LEVEL SECURITY with the tenant_isolation policy (the generated block below);
--      * REVOKE UPDATE, DELETE from calibra_app: the trigger yields to a GUC any session
--        can set, the revoke does not. The owner path keeps its privileges.
--
-- The generated block below is the full tenant_isolation block (it is repeated in every
-- migration that adds a tenant table; rls-sql.test.ts keeps it equal to schema.ts), and
-- RLS_ROLE_SQL re-grants DML on every table, so the REVOKE comes after it.
--
-- Idempotent. SET LOCAL lock_timeout fails fast instead of queueing behind a long
-- transaction while the short ACCESS EXCLUSIVE locks are taken.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint

ALTER TABLE "organization_signing_certificate" ADD COLUMN IF NOT EXISTS "kek_id" text;
--> statement-breakpoint
ALTER TABLE "organization_signing_certificate" ADD COLUMN IF NOT EXISTS "custody_format_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "organization_signing_certificate" DROP CONSTRAINT IF EXISTS "organization_signing_certificate_custody_check";
--> statement-breakpoint
ALTER TABLE "organization_signing_certificate"
  ADD CONSTRAINT "organization_signing_certificate_custody_check"
  CHECK (
    (custody_format_version = 1 AND kek_id IS NULL)
    OR (custody_format_version = 2 AND kek_id IS NOT NULL)
  );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_compliance_audit_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "unit_id" integer,
  "action" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text,
  "changes" jsonb,
  "performed_by" text,
  "ip_address" text,
  "performed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organization_compliance_audit_log_unit_id_organization_unit_id_fk'
  ) THEN
    ALTER TABLE "organization_compliance_audit_log"
      ADD CONSTRAINT "organization_compliance_audit_log_unit_id_organization_unit_id_fk"
      FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organization_compliance_audit_log_performed_by_user_id_fk'
  ) THEN
    ALTER TABLE "organization_compliance_audit_log"
      ADD CONSTRAINT "organization_compliance_audit_log_performed_by_user_id_fk"
      FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_compliance_audit_org_idx" ON "organization_compliance_audit_log" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_compliance_audit_action_idx" ON "organization_compliance_audit_log" USING btree ("action");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_compliance_audit_performed_at_idx" ON "organization_compliance_audit_log" USING btree ("performed_at");
--> statement-breakpoint
DROP TRIGGER IF EXISTS organization_compliance_audit_log_append_only ON public.organization_compliance_audit_log;
--> statement-breakpoint
CREATE TRIGGER organization_compliance_audit_log_append_only
  BEFORE UPDATE OR DELETE ON public.organization_compliance_audit_log
  FOR EACH ROW EXECUTE FUNCTION calibra_append_only();
--> statement-breakpoint
DO $$
DECLARE
  me record;
  foreign_tables integer;
BEGIN
  SELECT rolsuper, rolbypassrls INTO me FROM pg_roles WHERE rolname = current_user;
  IF me.rolsuper OR me.rolbypassrls THEN
    RETURN;
  END IF;
  SELECT count(*) INTO foreign_tables FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
      AND NOT pg_has_role(current_user, c.relowner, 'USAGE');
  IF foreign_tables > 0 THEN
    RAISE EXCEPTION 'calibra: migration 0123 is run as %, which is neither the owner of the tenant tables nor superuser/BYPASSRLS, so row-level security would bind it (and the API when it shares this DATABASE_URL). Run migrations as the owner of the tables; see DEPLOYMENT.md, "Row-level security".', current_user
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$$;
--> statement-breakpoint
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
--> statement-breakpoint
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
ALTER TABLE public."organization_compliance_audit_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."organization_compliance_audit_log";
CREATE POLICY tenant_isolation ON public."organization_compliance_audit_log" AS PERMISSIVE FOR ALL TO calibra_app
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
--> statement-breakpoint
-- Append-only for the application role (after the blanket grant above).
REVOKE UPDATE, DELETE ON TABLE public."organization_compliance_audit_log" FROM calibra_app;
