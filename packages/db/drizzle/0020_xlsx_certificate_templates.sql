CREATE TABLE IF NOT EXISTS "certificate_template_version" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"template_id" integer NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"xlsx_r2_key" text NOT NULL,
	"xlsx_sha256" text NOT NULL,
	"binding_manifest" jsonb NOT NULL,
	"binding_manifest_sha256" text NOT NULL,
	"render_policy" jsonb NOT NULL,
	"analysis" jsonb,
	"validation_result" jsonb,
	"created_by" text NOT NULL,
	"published_at" timestamp,
	"published_by" text,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "certificate_template_assignment" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"template_id" integer NOT NULL,
	"template_version_id" integer NOT NULL,
	"unit_id" integer,
	"service_id" integer,
	"method_id" integer,
	"certificate_type" text DEFAULT 'calibration' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "certificate_template_preview" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"template_version_id" integer NOT NULL,
	"sample_data" jsonb,
	"filled_xlsx_r2_key" text,
	"pdf_r2_key" text,
	"pdf_sha256" text,
	"render_metadata" jsonb,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"error" text,
	"requested_by" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "issued_certificate_snapshot" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"job_id" integer NOT NULL,
	"template_id" integer NOT NULL,
	"template_version_id" integer NOT NULL,
	"certificate_number" text,
	"filled_xlsx_r2_key" text NOT NULL,
	"filled_xlsx_sha256" text NOT NULL,
	"pdf_r2_key" text NOT NULL,
	"pdf_sha256" text NOT NULL,
	"binding_manifest_sha256" text NOT NULL,
	"render_policy" jsonb NOT NULL,
	"render_metadata" jsonb,
	"input_data_snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'ISSUED' NOT NULL,
	"issued_by" text,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"superseded_by_id" integer,
	"voided_at" timestamp,
	"voided_by" text,
	"void_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "certificate_template_version" ADD CONSTRAINT "certificate_template_version_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_template_version" ADD CONSTRAINT "certificate_template_version_template_id_certificate_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."certificate_template"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_template_version" ADD CONSTRAINT "certificate_template_version_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_template_version" ADD CONSTRAINT "certificate_template_version_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_template_assignment" ADD CONSTRAINT "certificate_template_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_template_assignment" ADD CONSTRAINT "certificate_template_assignment_template_id_certificate_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."certificate_template"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_template_assignment" ADD CONSTRAINT "certificate_template_assignment_template_version_id_certificate_template_version_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."certificate_template_version"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_template_assignment" ADD CONSTRAINT "certificate_template_assignment_unit_id_organization_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_template_assignment" ADD CONSTRAINT "certificate_template_assignment_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_template_assignment" ADD CONSTRAINT "certificate_template_assignment_method_id_calibration_method_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."calibration_method"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_template_assignment" ADD CONSTRAINT "certificate_template_assignment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_template_preview" ADD CONSTRAINT "certificate_template_preview_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_template_preview" ADD CONSTRAINT "certificate_template_preview_template_version_id_certificate_template_version_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."certificate_template_version"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_template_preview" ADD CONSTRAINT "certificate_template_preview_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "issued_certificate_snapshot" ADD CONSTRAINT "issued_certificate_snapshot_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "issued_certificate_snapshot" ADD CONSTRAINT "issued_certificate_snapshot_job_id_calibration_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."calibration_job"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "issued_certificate_snapshot" ADD CONSTRAINT "issued_certificate_snapshot_template_id_certificate_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."certificate_template"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "issued_certificate_snapshot" ADD CONSTRAINT "issued_certificate_snapshot_template_version_id_certificate_template_version_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."certificate_template_version"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "issued_certificate_snapshot" ADD CONSTRAINT "issued_certificate_snapshot_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "issued_certificate_snapshot" ADD CONSTRAINT "issued_certificate_snapshot_voided_by_user_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certificate_template_version_org_idx" ON "certificate_template_version" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certificate_template_version_template_idx" ON "certificate_template_version" USING btree ("template_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certificate_template_version_status_idx" ON "certificate_template_version" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "certificate_template_version_template_version_uidx" ON "certificate_template_version" USING btree ("template_id","version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certificate_template_assignment_org_idx" ON "certificate_template_assignment" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certificate_template_assignment_template_idx" ON "certificate_template_assignment" USING btree ("template_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certificate_template_assignment_version_idx" ON "certificate_template_assignment" USING btree ("template_version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certificate_template_assignment_unit_idx" ON "certificate_template_assignment" USING btree ("unit_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certificate_template_assignment_service_idx" ON "certificate_template_assignment" USING btree ("service_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certificate_template_assignment_method_idx" ON "certificate_template_assignment" USING btree ("method_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certificate_template_assignment_status_idx" ON "certificate_template_assignment" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certificate_template_preview_org_idx" ON "certificate_template_preview" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certificate_template_preview_version_idx" ON "certificate_template_preview" USING btree ("template_version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certificate_template_preview_status_idx" ON "certificate_template_preview" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certificate_template_preview_expires_at_idx" ON "certificate_template_preview" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issued_certificate_snapshot_org_idx" ON "issued_certificate_snapshot" USING btree ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "issued_certificate_snapshot_job_uidx" ON "issued_certificate_snapshot" USING btree ("job_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issued_certificate_snapshot_template_idx" ON "issued_certificate_snapshot" USING btree ("template_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issued_certificate_snapshot_version_idx" ON "issued_certificate_snapshot" USING btree ("template_version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issued_certificate_snapshot_status_idx" ON "issued_certificate_snapshot" USING btree ("status");
