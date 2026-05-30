-- Backoffice migration-importer audit (operations-console gap #12, preview-only).
-- One row per dry-run validation of an uploaded spreadsheet: entity, file,
-- pass/fail counts, the column mapping and an error sample, plus who ran it.
-- No domain records are written in this scope; the COMMITTED status is reserved
-- for the gated follow-up. Additive only.

CREATE TABLE "import_run" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "entity" text NOT NULL,
  "file_name" text,
  "status" text DEFAULT 'VALIDATED' NOT NULL,
  "total_rows" integer DEFAULT 0 NOT NULL,
  "valid_rows" integer DEFAULT 0 NOT NULL,
  "error_rows" integer DEFAULT 0 NOT NULL,
  "mapping" jsonb,
  "errors_sample" jsonb,
  "created_by_user_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "import_run_org_idx" ON "import_run" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "import_run_created_idx" ON "import_run" USING btree ("created_at");
