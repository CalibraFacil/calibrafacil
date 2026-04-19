CREATE TABLE "certificate_numbering_profile" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text DEFAULT 'Padrao' NOT NULL,
	"config" jsonb NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificate_numbering_sequence" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"profile_id" integer NOT NULL,
	"sequence_key" text NOT NULL,
	"current_value" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificate_numbering_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"profile_id" integer,
	"action" text NOT NULL,
	"changes" jsonb,
	"performed_by" text,
	"ip_address" text,
	"performed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calibration_job" ADD COLUMN "certificate_name" text;
--> statement-breakpoint
ALTER TABLE "calibration_job" ADD COLUMN "certificate_numbering_snapshot" jsonb;
--> statement-breakpoint
ALTER TABLE "certificate_numbering_profile" ADD CONSTRAINT "certificate_numbering_profile_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_numbering_profile" ADD CONSTRAINT "certificate_numbering_profile_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_numbering_profile" ADD CONSTRAINT "certificate_numbering_profile_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_numbering_sequence" ADD CONSTRAINT "certificate_numbering_sequence_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_numbering_sequence" ADD CONSTRAINT "certificate_numbering_sequence_profile_id_certificate_numbering_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."certificate_numbering_profile"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_numbering_audit_log" ADD CONSTRAINT "certificate_numbering_audit_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_numbering_audit_log" ADD CONSTRAINT "certificate_numbering_audit_log_profile_id_certificate_numbering_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."certificate_numbering_profile"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_numbering_audit_log" ADD CONSTRAINT "certificate_numbering_audit_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_numbering_profile_org_uidx" ON "certificate_numbering_profile" USING btree ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_numbering_sequence_uidx" ON "certificate_numbering_sequence" USING btree ("organization_id","profile_id","sequence_key");
--> statement-breakpoint
CREATE INDEX "certificate_numbering_audit_org_idx" ON "certificate_numbering_audit_log" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "certificate_numbering_audit_profile_idx" ON "certificate_numbering_audit_log" USING btree ("profile_id");
