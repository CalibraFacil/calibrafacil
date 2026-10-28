-- Reference standards: a versioned calibration history, and double precision (roadmap 2 C3;
-- review 3.1 H, 3.2 M).
--
-- 1. reference_standard's values were `real` (float4, ~7 significant digits). They become
--    double precision, through their text form so a stored 0.1 stays 0.1 (not 0.100000001...).
-- 2. reference_standard_calibration: one row per calibration certificate of a standard (the
--    values and the validity interval it gave). A renewal appends a row; work done on a day is
--    judged by the certificate valid that day. Append-only evidence (trigger + the generated
--    evidence grants), row-level security, a soft reference to the standard (the history
--    outlives it). Backfilled with one row per existing standard (source 'backfill').
--
-- Idempotent.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "reference_standard"
  ALTER COLUMN "reference_value" TYPE double precision USING "reference_value"::text::double precision,
  ALTER COLUMN "uncertainty" TYPE double precision USING "uncertainty"::text::double precision,
  ALTER COLUMN "coverage_factor" TYPE double precision USING "coverage_factor"::text::double precision,
  ALTER COLUMN "drift" TYPE double precision USING "drift"::text::double precision;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reference_standard_calibration" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE restrict,
  "standard_id" integer NOT NULL,
  "certificate_number" text NOT NULL,
  "calibrated_by" text,
  "calibration_provider_accreditation_number" text,
  "calibration_provider_mra_recognized" boolean DEFAULT false NOT NULL,
  "calibration_date" date NOT NULL,
  "next_calibration_date" date NOT NULL,
  "reference_value" double precision,
  "uncertainty" double precision,
  "uncertainty_unit" text,
  "coverage_factor" double precision,
  "certified_values" jsonb,
  "metrology_data" jsonb,
  "source" text NOT NULL,
  "recorded_by" text REFERENCES "user"("id") ON DELETE set null,
  "recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reference_standard_calibration_standard_idx"
  ON "reference_standard_calibration" USING btree ("organization_id", "standard_id", "calibration_date");
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reference_standard_calibration_interval_check') THEN
    ALTER TABLE "reference_standard_calibration"
      ADD CONSTRAINT "reference_standard_calibration_interval_check"
      CHECK ("next_calibration_date" >= "calibration_date");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reference_standard_calibration_source_check') THEN
    ALTER TABLE "reference_standard_calibration"
      ADD CONSTRAINT "reference_standard_calibration_source_check"
      CHECK ("source" IN ('create', 'renew', 'backfill'));
  END IF;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS reference_standard_calibration_append_only ON public.reference_standard_calibration;
--> statement-breakpoint
CREATE TRIGGER reference_standard_calibration_append_only
  BEFORE UPDATE OR DELETE ON public.reference_standard_calibration
  FOR EACH ROW EXECUTE FUNCTION calibra_append_only();
--> statement-breakpoint
-- Backfill: the certificate each standard carries now (deleted standards included: their
-- history is evidence of the work they were used in).
INSERT INTO "reference_standard_calibration"
  ("organization_id", "standard_id", "certificate_number", "calibrated_by",
   "calibration_provider_accreditation_number", "calibration_provider_mra_recognized",
   "calibration_date", "next_calibration_date", "reference_value", "uncertainty",
   "uncertainty_unit", "coverage_factor", "certified_values", "metrology_data",
   "source", "recorded_by", "recorded_at")
SELECT s."organization_id", s."id", s."certificate_number", s."calibrated_by",
       s."calibration_provider_accreditation_number", s."calibration_provider_mra_recognized",
       s."calibration_date", greatest(s."next_calibration_date", s."calibration_date"),
       s."reference_value", s."uncertainty", s."uncertainty_unit", s."coverage_factor",
       s."certified_values", s."metrology_data", 'backfill', NULL, s."updated_at"
  FROM "reference_standard" s
 WHERE NOT EXISTS (
   SELECT 1 FROM "reference_standard_calibration" c WHERE c."standard_id" = s."id"
 )
 ORDER BY s."id";
--> statement-breakpoint
-- Row-level security: the generated block now carries reference_standard_calibration, and
-- the evidence grants revoke UPDATE, DELETE and TRUNCATE on it from calibra_app, right after
-- the blanket GRANT of the role statement.
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
REVOKE UPDATE, DELETE, TRUNCATE ON public."issued_certificate_status_event" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."job_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."method_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."non_conformance_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."organization_api_key_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."organization_compliance_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."organization_event_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."personnel_competence_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."proficiency_test_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."reference_standard_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."reference_standard_calibration" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."service_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."service_order_event_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."training_record_audit_log" FROM calibra_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public."visit_audit_log" FROM calibra_app;
REVOKE UPDATE, TRUNCATE ON public."certificate_input" FROM calibra_app;
-- END generated: calibra_evidence_grants
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
ALTER TABLE public."issued_certificate_status_event" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."issued_certificate_status_event";
CREATE POLICY tenant_isolation ON public."issued_certificate_status_event" AS PERMISSIVE FOR ALL TO calibra_app
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
ALTER TABLE public."reference_standard_calibration" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."reference_standard_calibration";
CREATE POLICY tenant_isolation ON public."reference_standard_calibration" AS PERMISSIVE FOR ALL TO calibra_app
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
