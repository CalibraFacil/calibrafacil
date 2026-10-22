-- The frozen input of a certificate (ISO/IEC 17025 §7.8: the report reflects the
-- approved record).
--
-- The approval transaction writes one `certificate_input` row per approved job: the
-- lab identity and accreditation, the signatory, the accreditation-seal decision as of
-- approved_at, the customer and asset, the execution results, the standards snapshot,
-- the method, the layout and engine identity (document: certificate-data, packages/
-- certificate-data/src/certificate-input.ts). The worker renders from it and never
-- reads that data live again; jobs approved before this migration have no row and keep
-- rendering through the legacy live path.
--
--   1. The table: 1:1 with the job (unique job_id), organization_id NOT NULL with a
--      RESTRICT foreign key and the composite (job_id, organization_id) tenant key
--      of migration 0118, so a row cannot point at another tenant's job. The sha256 is
--      the hash of the canonical JSON of `input` (also recorded on the approve audit row).
--   2. The immutability guard: a row never changes; it can only be deleted while its
--      job is back in REVIEW (an approval whose dispatch failed is reverted, a rejected
--      job is approved again). The seed escape hatch of migration 0115
--      (calibra.allow_audit_rewrite) lifts it for one transaction, which is also how the
--      records purge job erases an organization.
--
-- Functions and triggers are not expressible in schema.ts, so the same objects are
-- repeated in sql/schema-extras.sql (used to build new databases). Idempotent, because
-- this project applies migration DDL by hand and the drizzle bookkeeping table lags
-- behind it.
CREATE TABLE IF NOT EXISTS "certificate_input" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "job_id" integer NOT NULL,
  "schema_version" integer NOT NULL,
  "input" jsonb NOT NULL,
  "sha256" text NOT NULL,
  "layout_key" text NOT NULL,
  "layout_version" text NOT NULL,
  "engine_version" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'certificate_input_organization_id_organization_id_fk') THEN
    ALTER TABLE "certificate_input"
      ADD CONSTRAINT "certificate_input_organization_id_organization_id_fk"
      FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'certificate_input_job_id_calibration_job_id_fk') THEN
    ALTER TABLE "certificate_input"
      ADD CONSTRAINT "certificate_input_job_id_calibration_job_id_fk"
      FOREIGN KEY ("job_id") REFERENCES "public"."calibration_job"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'certificate_input_job_id_tenant_fk') THEN
    ALTER TABLE "certificate_input"
      ADD CONSTRAINT "certificate_input_job_id_tenant_fk"
      FOREIGN KEY ("job_id", "organization_id")
      REFERENCES "public"."calibration_job"("id", "organization_id")
      ON DELETE restrict ON UPDATE no action;
  END IF;
END
$$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "certificate_input_job_uidx" ON "certificate_input" USING btree ("job_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certificate_input_org_idx" ON "certificate_input" USING btree ("organization_id");
--> statement-breakpoint
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
--> statement-breakpoint
DROP TRIGGER IF EXISTS certificate_input_immutable_guard ON public.certificate_input;
--> statement-breakpoint
CREATE TRIGGER certificate_input_immutable_guard
  BEFORE UPDATE OR DELETE ON public.certificate_input
  FOR EACH ROW EXECUTE FUNCTION calibra_certificate_input_guard();
