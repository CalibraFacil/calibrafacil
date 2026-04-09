CREATE TABLE "corrective_action" (
	"id" serial PRIMARY KEY NOT NULL,
	"capa_number" text NOT NULL,
	"organization_id" text NOT NULL,
	"source" text DEFAULT 'nc_detection' NOT NULL,
	"source_reference" text,
	"title" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"detection_date" timestamp,
	"type" text DEFAULT 'corrective' NOT NULL,
	"severity" text DEFAULT 'minor' NOT NULL,
	"category" text DEFAULT 'procedure' NOT NULL,
	"root_cause_analysis" text,
	"rca_method" text,
	"action_plan" text,
	"preventive_measures" text,
	"responsible_id" text,
	"due_date" timestamp,
	"implementation_evidence" text,
	"implemented_at" timestamp,
	"investigation_completed_at" timestamp,
	"verified_at" timestamp,
	"verified_by" text,
	"verification_notes" text,
	"effectiveness_confirmed" boolean,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"closed_at" timestamp,
	"closed_by" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "corrective_action_capa_number_unique" UNIQUE("capa_number")
);
--> statement-breakpoint
CREATE TABLE "corrective_action_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"capa_id" integer NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "environmental_limits" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"asset_type_id" integer,
	"temperature_min" real,
	"temperature_max" real,
	"humidity_min" real,
	"humidity_max" real,
	"pressure_min" real,
	"pressure_max" real,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "env_limits_org_asset_type_uidx" UNIQUE NULLS NOT DISTINCT("organization_id","asset_type_id")
);
--> statement-breakpoint
CREATE TABLE "non_conformance" (
	"id" serial PRIMARY KEY NOT NULL,
	"nc_number" text NOT NULL,
	"organization_id" text NOT NULL,
	"job_id" integer,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"detected_by" text NOT NULL,
	"detected_at" timestamp NOT NULL,
	"disposition" text,
	"disposition_justification" text,
	"disposition_approved_by" text,
	"disposition_approved_at" timestamp,
	"correction_taken" text,
	"resolved_at" timestamp,
	"resolved_by" text,
	"status" text DEFAULT 'open' NOT NULL,
	"capa_id" integer,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "non_conformance_nc_number_unique" UNIQUE("nc_number")
);
--> statement-breakpoint
CREATE TABLE "non_conformance_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"nc_id" integer NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"reason" text
);
--> statement-breakpoint
ALTER TABLE "calibration_job" ADD COLUMN "environmental_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "corrective_action" ADD CONSTRAINT "corrective_action_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_action" ADD CONSTRAINT "corrective_action_responsible_id_user_id_fk" FOREIGN KEY ("responsible_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_action" ADD CONSTRAINT "corrective_action_verified_by_user_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_action" ADD CONSTRAINT "corrective_action_closed_by_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_action" ADD CONSTRAINT "corrective_action_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_action_audit_log" ADD CONSTRAINT "corrective_action_audit_log_capa_id_corrective_action_id_fk" FOREIGN KEY ("capa_id") REFERENCES "public"."corrective_action"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_action_audit_log" ADD CONSTRAINT "corrective_action_audit_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environmental_limits" ADD CONSTRAINT "environmental_limits_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environmental_limits" ADD CONSTRAINT "environmental_limits_asset_type_id_asset_type_id_fk" FOREIGN KEY ("asset_type_id") REFERENCES "public"."asset_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environmental_limits" ADD CONSTRAINT "environmental_limits_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "non_conformance" ADD CONSTRAINT "non_conformance_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "non_conformance" ADD CONSTRAINT "non_conformance_job_id_calibration_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."calibration_job"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "non_conformance" ADD CONSTRAINT "non_conformance_detected_by_user_id_fk" FOREIGN KEY ("detected_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "non_conformance" ADD CONSTRAINT "non_conformance_disposition_approved_by_user_id_fk" FOREIGN KEY ("disposition_approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "non_conformance" ADD CONSTRAINT "non_conformance_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "non_conformance" ADD CONSTRAINT "non_conformance_capa_id_corrective_action_id_fk" FOREIGN KEY ("capa_id") REFERENCES "public"."corrective_action"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "non_conformance" ADD CONSTRAINT "non_conformance_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "non_conformance_audit_log" ADD CONSTRAINT "non_conformance_audit_log_nc_id_non_conformance_id_fk" FOREIGN KEY ("nc_id") REFERENCES "public"."non_conformance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "non_conformance_audit_log" ADD CONSTRAINT "non_conformance_audit_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capa_organization_id_idx" ON "corrective_action" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "capa_status_idx" ON "corrective_action" USING btree ("status");--> statement-breakpoint
CREATE INDEX "capa_responsible_id_idx" ON "corrective_action" USING btree ("responsible_id");--> statement-breakpoint
CREATE INDEX "capa_severity_idx" ON "corrective_action" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "capa_category_idx" ON "corrective_action" USING btree ("category");--> statement-breakpoint
CREATE INDEX "capa_source_idx" ON "corrective_action" USING btree ("source");--> statement-breakpoint
CREATE UNIQUE INDEX "capa_number_uidx" ON "corrective_action" USING btree ("capa_number");--> statement-breakpoint
CREATE INDEX "capa_audit_log_capa_id_idx" ON "corrective_action_audit_log" USING btree ("capa_id");--> statement-breakpoint
CREATE INDEX "capa_audit_log_performed_at_idx" ON "corrective_action_audit_log" USING btree ("performed_at");--> statement-breakpoint
CREATE INDEX "env_limits_organization_id_idx" ON "environmental_limits" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "nc_organization_id_idx" ON "non_conformance" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "nc_job_id_idx" ON "non_conformance" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "nc_status_idx" ON "non_conformance" USING btree ("status");--> statement-breakpoint
CREATE INDEX "nc_type_idx" ON "non_conformance" USING btree ("type");--> statement-breakpoint
CREATE INDEX "nc_detected_at_idx" ON "non_conformance" USING btree ("detected_at");--> statement-breakpoint
CREATE INDEX "nc_capa_id_idx" ON "non_conformance" USING btree ("capa_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nc_number_uidx" ON "non_conformance" USING btree ("nc_number");--> statement-breakpoint
CREATE INDEX "nc_audit_log_nc_id_idx" ON "non_conformance_audit_log" USING btree ("nc_id");--> statement-breakpoint
CREATE INDEX "nc_audit_log_performed_at_idx" ON "non_conformance_audit_log" USING btree ("performed_at");