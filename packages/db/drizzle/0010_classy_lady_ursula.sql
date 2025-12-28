CREATE TABLE "reference_standard" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text,
	"serial_number" text NOT NULL,
	"manufacturer" text,
	"model" text,
	"certificate_number" text NOT NULL,
	"calibrated_by" text,
	"calibration_date" timestamp NOT NULL,
	"next_calibration_date" timestamp NOT NULL,
	"reference_value" real,
	"uncertainty" real,
	"uncertainty_unit" text,
	"coverage_factor" real DEFAULT 2 NOT NULL,
	"distribution" text DEFAULT 'normal' NOT NULL,
	"drift" real,
	"certified_values" jsonb,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "reference_standard_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"standard_id" integer NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"reason" text
);
--> statement-breakpoint
ALTER TABLE "reference_standard" ADD CONSTRAINT "reference_standard_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_standard" ADD CONSTRAINT "reference_standard_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_standard_audit_log" ADD CONSTRAINT "reference_standard_audit_log_standard_id_reference_standard_id_fk" FOREIGN KEY ("standard_id") REFERENCES "public"."reference_standard"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_standard_audit_log" ADD CONSTRAINT "reference_standard_audit_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "standard_organization_id_idx" ON "reference_standard" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "standard_status_idx" ON "reference_standard" USING btree ("status");--> statement-breakpoint
CREATE INDEX "standard_next_cal_date_idx" ON "reference_standard" USING btree ("next_calibration_date");--> statement-breakpoint
CREATE INDEX "standard_audit_log_standard_id_idx" ON "reference_standard_audit_log" USING btree ("standard_id");--> statement-breakpoint
CREATE INDEX "standard_audit_log_performed_at_idx" ON "reference_standard_audit_log" USING btree ("performed_at");