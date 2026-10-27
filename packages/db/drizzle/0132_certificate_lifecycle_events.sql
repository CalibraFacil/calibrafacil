-- Certificate lifecycle as an append-only event stream, and one amendment in progress per
-- certificate (roadmap 2 B3; ISO/IEC 17025 §7.8.8 amendments, §7.10 nonconforming work).
--
--   1. issued_certificate_status_event: ISSUED / SUPERSEDED / WITHDRAWN / REINSTATED rows,
--      written by the issuance, by the amendment's issuance (the original's SUPERSEDED,
--      in the same transaction that issues the replacement) and by the new withdraw
--      command. The state of a certificate is its LATEST event. issued_certificate_snapshot
--      already had status / superseded_by_id / voided_* columns, but the append-only
--      trigger of migration 0115 makes them unwritable, so nothing could ever record a
--      supersession or a withdrawal. The columns stay (no data is dropped) and are
--      deprecated; nothing reads them.
--      Append-only: a trigger refuses UPDATE and DELETE (same function as the other
--      evidence tables) and the application role loses UPDATE, DELETE and TRUNCATE on it
--      (the generated evidence-grants block below, from packages/db/src/evidence-tables.ts).
--      CHECKs: a known event, a written reason for WITHDRAWN and REINSTATED, and the
--      replacement job for SUPERSEDED.
--   2. Backfill: every existing certificate gets its ISSUED row, and every superseded
--      original its SUPERSEDED row (source = 'migration'), so the stream is complete
--      from the first read.
--   3. job_supersedes_id_uidx becomes partial: it no longer counts a CANCELED amendment.
--      The original now stays APPROVED (the valid certificate) while its amendment is in
--      progress and is superseded only when the replacement is issued; cancelling the
--      amendment must let the original be amended again, and a terminal CANCELED job is
--      not "in progress". REJECTED stays in the index on purpose: a rejected amendment
--      can be fixed and resubmitted, so it still occupies the slot until it is cancelled.
--      No calibration_job_status_guard change: APPROVED -> SUPERSEDED already exists, the
--      amendment only moves it from creation time to issuance time.
--
-- Existing rows are not re-validated. Originals that an earlier release superseded at
-- creation time and whose amendment was then cancelled stay as they are (SUPERSEDED, with
-- a CANCELED replacement): the immutability triggers make that status irreversible, and
-- repairing it is an audited, human decision (see docs/architecture-roadmap-2.md, B3).
--
-- Functions and triggers are not expressible in schema.ts, so the same objects are
-- repeated in sql/schema-extras.sql (used to build new databases). Idempotent, because
-- this project applies migration DDL by hand and the drizzle bookkeeping table lags
-- behind it. The RLS block below is the generated one (`pnpm --filter @calibra-facil/db
-- gen:rls-sql`), now including the new tenant table.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "issued_certificate_status_event" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "certificate_id" integer NOT NULL,
  "job_id" integer NOT NULL,
  "event" text NOT NULL,
  "superseded_by_job_id" integer,
  "reason" text,
  "actor_user_id" text,
  "source" text NOT NULL,
  "occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issued_certificate_status_event_organization_id_organization_id_fk') THEN
    ALTER TABLE "issued_certificate_status_event"
      ADD CONSTRAINT "issued_certificate_status_event_organization_id_organization_id_fk"
      FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issued_certificate_status_event_certificate_id_issued_certificate_snapshot_id_fk') THEN
    ALTER TABLE "issued_certificate_status_event"
      ADD CONSTRAINT "issued_certificate_status_event_certificate_id_issued_certificate_snapshot_id_fk"
      FOREIGN KEY ("certificate_id") REFERENCES "public"."issued_certificate_snapshot"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issued_certificate_status_event_job_id_calibration_job_id_fk') THEN
    ALTER TABLE "issued_certificate_status_event"
      ADD CONSTRAINT "issued_certificate_status_event_job_id_calibration_job_id_fk"
      FOREIGN KEY ("job_id") REFERENCES "public"."calibration_job"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issued_certificate_status_event_superseded_by_job_id_calibration_job_id_fk') THEN
    ALTER TABLE "issued_certificate_status_event"
      ADD CONSTRAINT "issued_certificate_status_event_superseded_by_job_id_calibration_job_id_fk"
      FOREIGN KEY ("superseded_by_job_id") REFERENCES "public"."calibration_job"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issued_certificate_status_event_actor_user_id_user_id_fk') THEN
    ALTER TABLE "issued_certificate_status_event"
      ADD CONSTRAINT "issued_certificate_status_event_actor_user_id_user_id_fk"
      FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issued_certificate_status_event_job_id_tenant_fk') THEN
    ALTER TABLE "issued_certificate_status_event"
      ADD CONSTRAINT "issued_certificate_status_event_job_id_tenant_fk"
      FOREIGN KEY ("job_id", "organization_id")
      REFERENCES "public"."calibration_job"("id", "organization_id")
      ON DELETE restrict ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issued_certificate_status_event_event_check') THEN
    ALTER TABLE "issued_certificate_status_event"
      ADD CONSTRAINT "issued_certificate_status_event_event_check"
      CHECK ("event" IN ('ISSUED', 'SUPERSEDED', 'WITHDRAWN', 'REINSTATED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issued_certificate_status_event_reason_check') THEN
    ALTER TABLE "issued_certificate_status_event"
      ADD CONSTRAINT "issued_certificate_status_event_reason_check"
      CHECK ("event" NOT IN ('WITHDRAWN', 'REINSTATED') OR length(btrim(coalesce("reason", ''))) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issued_certificate_status_event_superseded_by_check') THEN
    ALTER TABLE "issued_certificate_status_event"
      ADD CONSTRAINT "issued_certificate_status_event_superseded_by_check"
      CHECK ("event" <> 'SUPERSEDED' OR "superseded_by_job_id" IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issued_certificate_status_event_source_check') THEN
    ALTER TABLE "issued_certificate_status_event"
      ADD CONSTRAINT "issued_certificate_status_event_source_check"
      CHECK ("source" IN ('api', 'worker', 'migration'));
  END IF;
END
$$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issued_certificate_status_event_cert_idx" ON "issued_certificate_status_event" USING btree ("certificate_id", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issued_certificate_status_event_job_idx" ON "issued_certificate_status_event" USING btree ("job_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issued_certificate_status_event_org_idx" ON "issued_certificate_status_event" USING btree ("organization_id");
--> statement-breakpoint
-- Append-only, with the same guard as the other evidence tables (migration 0115).
DROP TRIGGER IF EXISTS issued_certificate_status_event_append_only ON public.issued_certificate_status_event;
--> statement-breakpoint
CREATE TRIGGER issued_certificate_status_event_append_only
  BEFORE UPDATE OR DELETE ON public.issued_certificate_status_event
  FOR EACH ROW EXECUTE FUNCTION calibra_append_only();
--> statement-breakpoint
-- Backfill (source = 'migration'): ISSUED for every existing certificate, then SUPERSEDED for
-- every original an amendment already replaced, so the later event wins.
INSERT INTO "issued_certificate_status_event"
  ("organization_id", "certificate_id", "job_id", "event", "actor_user_id", "source", "occurred_at")
SELECT s."organization_id", s."id", s."job_id", 'ISSUED', s."issued_by", 'migration', s."issued_at"
  FROM "issued_certificate_snapshot" s
 WHERE NOT EXISTS (
   SELECT 1 FROM "issued_certificate_status_event" e
    WHERE e."certificate_id" = s."id" AND e."event" = 'ISSUED'
 )
 ORDER BY s."id";
--> statement-breakpoint
INSERT INTO "issued_certificate_status_event"
  ("organization_id", "certificate_id", "job_id", "event", "superseded_by_job_id", "reason", "source", "occurred_at")
SELECT s."organization_id", s."id", s."job_id", 'SUPERSEDED', j."superseded_by_id", j."amendment_reason",
       'migration', coalesce(j."superseded_at", s."issued_at")
  FROM "issued_certificate_snapshot" s
  JOIN "calibration_job" j ON j."id" = s."job_id"
 WHERE j."status" = 'SUPERSEDED'
   AND j."superseded_by_id" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "issued_certificate_status_event" e
      WHERE e."certificate_id" = s."id" AND e."event" = 'SUPERSEDED'
   )
 ORDER BY s."id";
--> statement-breakpoint
-- One amendment in progress per certificate: the unique index stops counting a CANCELED one.
DROP INDEX IF EXISTS "job_supersedes_id_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_supersedes_id_uidx"
  ON "calibration_job" ("supersedes_id")
  WHERE "supersedes_id" IS NOT NULL AND "status" <> 'CANCELED';
--> statement-breakpoint
-- Row-level security: the generated block now carries issued_certificate_status_event, and the
-- evidence grants (generated from packages/db/src/evidence-tables.ts) revoke UPDATE, DELETE and
-- TRUNCATE on it from calibra_app, right after the blanket GRANT of the role statement.
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

../..                                    | [WARN] Unsupported engine: wanted: {"node":">=24"} (current: {"node":"v22.21.1","pnpm":"11.3.0"})
Scope: all 32 workspace projects

Done in 5.5s using pnpm v11.3.0
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
