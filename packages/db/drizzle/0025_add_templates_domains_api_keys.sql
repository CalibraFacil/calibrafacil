CREATE TABLE "organization_custom_domain" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "hostname" text NOT NULL,
  "verification_token" text NOT NULL,
  "verified_at" timestamp,
  "activated_at" timestamp,
  "last_verified_at" timestamp,
  "is_active" boolean DEFAULT false NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "org_custom_domain_hostname_unique" UNIQUE("hostname")
);
--> statement-breakpoint
CREATE TABLE "certificate_template" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "status" text DEFAULT 'ACTIVE' NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "config" jsonb NOT NULL,
  "created_by" text NOT NULL,
  "archived_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_api_key" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "name" text NOT NULL,
  "key_prefix" text NOT NULL,
  "key_hash" text NOT NULL,
  "scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "last_used_at" timestamp,
  "last_used_ip" text,
  "created_by" text NOT NULL,
  "revoked_at" timestamp,
  "revoked_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "organization_api_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "organization_api_key_audit_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "api_key_id" text NOT NULL,
  "organization_id" text NOT NULL,
  "action" text NOT NULL,
  "performed_by" text,
  "ip_address" text,
  "details" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calibration_job"
  ADD COLUMN "certificate_template_id" integer;
--> statement-breakpoint
ALTER TABLE "calibration_job"
  ADD COLUMN "certificate_template_snapshot" jsonb;
--> statement-breakpoint
ALTER TABLE "organization_custom_domain"
  ADD CONSTRAINT "org_custom_domain_organization_id_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "organization_custom_domain"
  ADD CONSTRAINT "org_custom_domain_created_by_user_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "public"."user"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_template"
  ADD CONSTRAINT "certificate_template_organization_id_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_template"
  ADD CONSTRAINT "certificate_template_created_by_user_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "public"."user"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "organization_api_key"
  ADD CONSTRAINT "organization_api_key_organization_id_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "organization_api_key"
  ADD CONSTRAINT "organization_api_key_created_by_user_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "public"."user"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "organization_api_key"
  ADD CONSTRAINT "organization_api_key_revoked_by_user_id_fk"
  FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "organization_api_key_audit_log"
  ADD CONSTRAINT "organization_api_key_audit_log_api_key_id_fk"
  FOREIGN KEY ("api_key_id") REFERENCES "public"."organization_api_key"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "organization_api_key_audit_log"
  ADD CONSTRAINT "organization_api_key_audit_log_org_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "organization_api_key_audit_log"
  ADD CONSTRAINT "organization_api_key_audit_log_performed_by_user_id_fk"
  FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calibration_job"
  ADD CONSTRAINT "calibration_job_certificate_template_id_fk"
  FOREIGN KEY ("certificate_template_id") REFERENCES "public"."certificate_template"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "org_custom_domain_org_uidx"
  ON "organization_custom_domain" ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "org_custom_domain_hostname_uidx"
  ON "organization_custom_domain" ("hostname");
--> statement-breakpoint
CREATE INDEX "org_custom_domain_active_idx"
  ON "organization_custom_domain" ("is_active");
--> statement-breakpoint
CREATE INDEX "certificate_template_org_id_idx"
  ON "certificate_template" ("organization_id");
--> statement-breakpoint
CREATE INDEX "certificate_template_status_idx"
  ON "certificate_template" ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_template_org_slug_uidx"
  ON "certificate_template" ("organization_id", "slug");
--> statement-breakpoint
CREATE INDEX "organization_api_key_org_id_idx"
  ON "organization_api_key" ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "organization_api_key_hash_uidx"
  ON "organization_api_key" ("key_hash");
--> statement-breakpoint
CREATE INDEX "organization_api_key_audit_log_key_idx"
  ON "organization_api_key_audit_log" ("api_key_id");
--> statement-breakpoint
CREATE INDEX "organization_api_key_audit_log_org_idx"
  ON "organization_api_key_audit_log" ("organization_id");
--> statement-breakpoint
CREATE INDEX "job_certificate_template_id_idx"
  ON "calibration_job" ("certificate_template_id");
