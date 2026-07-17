-- wysiwyg certificate template engine (epic: wysiwyg, spec 02 §1).
-- Additive/NULL-relaxing only; existing rows keep engine='xlsx' via DEFAULT.
ALTER TABLE "certificate_template_version" ALTER COLUMN "xlsx_r2_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "certificate_template_version" ALTER COLUMN "xlsx_sha256" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "certificate_template_version" ALTER COLUMN "binding_manifest" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "certificate_template_version" ALTER COLUMN "binding_manifest_sha256" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "certificate_template_version" ADD COLUMN "engine" text DEFAULT 'xlsx' NOT NULL;--> statement-breakpoint
ALTER TABLE "certificate_template_version" ADD COLUMN "document_json" jsonb;--> statement-breakpoint
ALTER TABLE "certificate_template_version" ADD COLUMN "document_sha256" text;--> statement-breakpoint
ALTER TABLE "certificate_template_version" ADD CONSTRAINT "ctv_engine_payload_check" CHECK (
  ("engine" = 'xlsx' AND "xlsx_r2_key" IS NOT NULL AND "xlsx_sha256" IS NOT NULL
    AND "binding_manifest" IS NOT NULL AND "binding_manifest_sha256" IS NOT NULL)
  OR ("engine" = 'wysiwyg' AND "document_json" IS NOT NULL AND "document_sha256" IS NOT NULL)
);--> statement-breakpoint
ALTER TABLE "issued_certificate_snapshot" ALTER COLUMN "filled_xlsx_r2_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "issued_certificate_snapshot" ALTER COLUMN "filled_xlsx_sha256" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "issued_certificate_snapshot" ALTER COLUMN "binding_manifest_sha256" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "issued_certificate_snapshot" ADD COLUMN "engine" text DEFAULT 'xlsx' NOT NULL;--> statement-breakpoint
ALTER TABLE "issued_certificate_snapshot" ADD COLUMN "compiled_html_r2_key" text;--> statement-breakpoint
ALTER TABLE "issued_certificate_snapshot" ADD COLUMN "compiled_html_sha256" text;--> statement-breakpoint
ALTER TABLE "issued_certificate_snapshot" ADD CONSTRAINT "ics_engine_artifact_check" CHECK (
  ("engine" = 'xlsx' AND "filled_xlsx_r2_key" IS NOT NULL AND "filled_xlsx_sha256" IS NOT NULL)
  OR ("engine" = 'wysiwyg' AND "compiled_html_r2_key" IS NOT NULL AND "compiled_html_sha256" IS NOT NULL)
);
