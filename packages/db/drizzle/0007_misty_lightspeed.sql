CREATE TABLE "calibration_method" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"asset_type_id" integer,
	"name" text NOT NULL,
	"description" text,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"data_fields" jsonb NOT NULL,
	"formulas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"validations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"uncertainty_params" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parent_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"published_at" timestamp,
	"published_by" text,
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "method_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"method_id" integer NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"reason" text
);
--> statement-breakpoint
ALTER TABLE "calibration_method" ADD CONSTRAINT "calibration_method_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_method" ADD CONSTRAINT "calibration_method_asset_type_id_asset_type_id_fk" FOREIGN KEY ("asset_type_id") REFERENCES "public"."asset_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_method" ADD CONSTRAINT "calibration_method_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_method" ADD CONSTRAINT "calibration_method_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "method_audit_log" ADD CONSTRAINT "method_audit_log_method_id_calibration_method_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."calibration_method"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "method_audit_log" ADD CONSTRAINT "method_audit_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "method_organization_id_idx" ON "calibration_method" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "method_asset_type_id_idx" ON "calibration_method" USING btree ("asset_type_id");--> statement-breakpoint
CREATE INDEX "method_status_idx" ON "calibration_method" USING btree ("status");--> statement-breakpoint
CREATE INDEX "method_parent_id_idx" ON "calibration_method" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "method_org_name_version_uidx" ON "calibration_method" USING btree ("organization_id","name","version");--> statement-breakpoint
CREATE INDEX "method_audit_log_method_id_idx" ON "method_audit_log" USING btree ("method_id");--> statement-breakpoint
CREATE INDEX "method_audit_log_performed_at_idx" ON "method_audit_log" USING btree ("performed_at");