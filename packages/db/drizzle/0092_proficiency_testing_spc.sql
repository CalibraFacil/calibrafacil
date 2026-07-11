CREATE TABLE "proficiency_test" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"unit_id" integer,
	"activity_type" text DEFAULT 'proficiency_test' NOT NULL,
	"provider" text NOT NULL,
	"provider_accreditation" text,
	"pt_round" text NOT NULL,
	"scope_part" text NOT NULL,
	"metrology_kind" text,
	"standard_id" integer,
	"registration_date" timestamp,
	"participation_date" timestamp,
	"result_reported_at" timestamp,
	"results" jsonb,
	"overall_status" text DEFAULT 'pending' NOT NULL,
	"capa_id" integer,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pt_plan_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"unit_id" integer,
	"scope_part" text NOT NULL,
	"risk_justification" text,
	"frequency_months" integer DEFAULT 48 NOT NULL,
	"last_satisfactory_at" timestamp,
	"next_due_at" timestamp,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proficiency_test_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"proficiency_test_id" integer NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "check_standard_reading" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"unit_id" integer,
	"standard_id" integer NOT NULL,
	"parameter" text NOT NULL,
	"value" double precision NOT NULL,
	"uncertainty" double precision,
	"measured_at" timestamp NOT NULL,
	"source_job_id" integer,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_chart" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"unit_id" integer,
	"standard_id" integer NOT NULL,
	"parameter" text NOT NULL,
	"chart_type" text DEFAULT 'i_mr' NOT NULL,
	"params" jsonb,
	"status" text DEFAULT 'insufficient_data' NOT NULL,
	"last_evaluation" jsonb,
	"last_evaluated_at" timestamp,
	"nc_id" integer,
	"capa_id" integer,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_chart_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"control_chart_id" integer NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"reason" text
);
--> statement-breakpoint
ALTER TABLE "proficiency_test" ADD CONSTRAINT "proficiency_test_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proficiency_test" ADD CONSTRAINT "proficiency_test_unit_id_organization_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proficiency_test" ADD CONSTRAINT "proficiency_test_standard_id_reference_standard_id_fk" FOREIGN KEY ("standard_id") REFERENCES "public"."reference_standard"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proficiency_test" ADD CONSTRAINT "proficiency_test_capa_id_corrective_action_id_fk" FOREIGN KEY ("capa_id") REFERENCES "public"."corrective_action"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proficiency_test" ADD CONSTRAINT "proficiency_test_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pt_plan_item" ADD CONSTRAINT "pt_plan_item_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pt_plan_item" ADD CONSTRAINT "pt_plan_item_unit_id_organization_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pt_plan_item" ADD CONSTRAINT "pt_plan_item_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proficiency_test_audit_log" ADD CONSTRAINT "proficiency_test_audit_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_standard_reading" ADD CONSTRAINT "check_standard_reading_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_standard_reading" ADD CONSTRAINT "check_standard_reading_unit_id_organization_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_standard_reading" ADD CONSTRAINT "check_standard_reading_standard_id_reference_standard_id_fk" FOREIGN KEY ("standard_id") REFERENCES "public"."reference_standard"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_standard_reading" ADD CONSTRAINT "check_standard_reading_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_chart" ADD CONSTRAINT "control_chart_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_chart" ADD CONSTRAINT "control_chart_unit_id_organization_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_chart" ADD CONSTRAINT "control_chart_standard_id_reference_standard_id_fk" FOREIGN KEY ("standard_id") REFERENCES "public"."reference_standard"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_chart" ADD CONSTRAINT "control_chart_nc_id_non_conformance_id_fk" FOREIGN KEY ("nc_id") REFERENCES "public"."non_conformance"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_chart" ADD CONSTRAINT "control_chart_capa_id_corrective_action_id_fk" FOREIGN KEY ("capa_id") REFERENCES "public"."corrective_action"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_chart" ADD CONSTRAINT "control_chart_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_chart_audit_log" ADD CONSTRAINT "control_chart_audit_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proficiency_test_organization_id_idx" ON "proficiency_test" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "proficiency_test_unit_id_idx" ON "proficiency_test" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "proficiency_test_status_idx" ON "proficiency_test" USING btree ("overall_status");--> statement-breakpoint
CREATE INDEX "proficiency_test_scope_part_idx" ON "proficiency_test" USING btree ("scope_part");--> statement-breakpoint
CREATE INDEX "proficiency_test_standard_id_idx" ON "proficiency_test" USING btree ("standard_id");--> statement-breakpoint
CREATE INDEX "pt_plan_item_organization_id_idx" ON "pt_plan_item" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "pt_plan_item_next_due_at_idx" ON "pt_plan_item" USING btree ("next_due_at");--> statement-breakpoint
CREATE INDEX "pt_audit_log_pt_id_idx" ON "proficiency_test_audit_log" USING btree ("proficiency_test_id");--> statement-breakpoint
CREATE INDEX "pt_audit_log_performed_at_idx" ON "proficiency_test_audit_log" USING btree ("performed_at");--> statement-breakpoint
CREATE INDEX "check_standard_reading_org_idx" ON "check_standard_reading" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "check_standard_reading_standard_idx" ON "check_standard_reading" USING btree ("standard_id","parameter","measured_at");--> statement-breakpoint
CREATE INDEX "control_chart_organization_id_idx" ON "control_chart" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "control_chart_status_idx" ON "control_chart" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "control_chart_standard_parameter_uidx" ON "control_chart" USING btree ("standard_id","parameter");--> statement-breakpoint
CREATE INDEX "control_chart_audit_log_chart_id_idx" ON "control_chart_audit_log" USING btree ("control_chart_id");--> statement-breakpoint
CREATE INDEX "control_chart_audit_log_performed_at_idx" ON "control_chart_audit_log" USING btree ("performed_at");
