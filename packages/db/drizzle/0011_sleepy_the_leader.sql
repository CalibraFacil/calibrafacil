CREATE TABLE "calibration_job" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"customer_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"service_id" integer NOT NULL,
	"technician_id" text,
	"method_snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"due_date" timestamp,
	"performed_at" timestamp,
	"data" jsonb,
	"results" jsonb,
	"certificate_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"approved_by" text,
	"approved_at" timestamp,
	"rejected_by" text,
	"rejected_at" timestamp,
	"rejection_reason" text
);
--> statement-breakpoint
CREATE TABLE "job_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"reason" text
);
--> statement-breakpoint
ALTER TABLE "calibration_job" ADD CONSTRAINT "calibration_job_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD CONSTRAINT "calibration_job_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD CONSTRAINT "calibration_job_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD CONSTRAINT "calibration_job_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD CONSTRAINT "calibration_job_technician_id_user_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD CONSTRAINT "calibration_job_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD CONSTRAINT "calibration_job_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD CONSTRAINT "calibration_job_rejected_by_user_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_audit_log" ADD CONSTRAINT "job_audit_log_job_id_calibration_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."calibration_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_audit_log" ADD CONSTRAINT "job_audit_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_organization_id_idx" ON "calibration_job" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "job_customer_id_idx" ON "calibration_job" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "job_asset_id_idx" ON "calibration_job" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "job_service_id_idx" ON "calibration_job" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "job_technician_id_idx" ON "calibration_job" USING btree ("technician_id");--> statement-breakpoint
CREATE INDEX "job_status_idx" ON "calibration_job" USING btree ("status");--> statement-breakpoint
CREATE INDEX "job_due_date_idx" ON "calibration_job" USING btree ("due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "job_org_job_id_uidx" ON "calibration_job" USING btree ("organization_id","job_id");--> statement-breakpoint
CREATE INDEX "job_audit_log_job_id_idx" ON "job_audit_log" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_audit_log_performed_at_idx" ON "job_audit_log" USING btree ("performed_at");--> statement-breakpoint
CREATE INDEX "job_audit_log_action_idx" ON "job_audit_log" USING btree ("action");