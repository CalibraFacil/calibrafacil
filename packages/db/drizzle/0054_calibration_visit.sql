-- On-site (calibração in loco) Phase 2: a calibration_visit is one scheduled
-- technician trip that can cover many instruments. The customer proposes a date
-- on the request; the lab confirms + assigns the technician. Each converted job
-- links back via calibration_job.visit_id. Additive + idempotent.
CREATE TABLE IF NOT EXISTS "calibration_visit" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"unit_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"source_request_id" integer,
	"technician_id" text,
	"status" text DEFAULT 'PROPOSED' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"scheduled_end_at" timestamp with time zone,
	"address" jsonb,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text
);
--> statement-breakpoint
ALTER TABLE "calibration_job" ADD COLUMN IF NOT EXISTS "visit_id" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calibration_visit" ADD CONSTRAINT "calibration_visit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calibration_visit" ADD CONSTRAINT "calibration_visit_unit_id_organization_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calibration_visit" ADD CONSTRAINT "calibration_visit_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calibration_visit" ADD CONSTRAINT "calibration_visit_source_request_id_calibration_request_id_fk" FOREIGN KEY ("source_request_id") REFERENCES "public"."calibration_request"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calibration_visit" ADD CONSTRAINT "calibration_visit_technician_id_user_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calibration_visit" ADD CONSTRAINT "calibration_visit_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calibration_visit" ADD CONSTRAINT "calibration_visit_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calibration_visit" ADD CONSTRAINT "calibration_visit_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calibration_job" ADD CONSTRAINT "calibration_job_visit_id_calibration_visit_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."calibration_visit"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calibration_visit_org_idx" ON "calibration_visit" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calibration_visit_unit_idx" ON "calibration_visit" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calibration_visit_customer_idx" ON "calibration_visit" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calibration_visit_technician_idx" ON "calibration_visit" USING btree ("technician_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calibration_visit_status_idx" ON "calibration_visit" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calibration_visit_scheduled_idx" ON "calibration_visit" USING btree ("scheduled_at");
