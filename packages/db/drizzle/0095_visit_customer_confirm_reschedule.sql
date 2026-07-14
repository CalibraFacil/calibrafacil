-- #739 Portal two-way on-site visit scheduling.
-- 1) Customer acknowledgement columns on calibration_visit: an annotation,
--    not a status transition — confirmedBy/At keep their lab-actor meaning.
--    Reset to NULL by the app whenever scheduled_at moves.
-- 2) visit_reschedule_request: first-class customer "this date doesn't work"
--    record (PENDING/ACCEPTED/DECLINED/SUPERSEDED) with preferred windows.
--    At most one PENDING request per visit (partial unique index).
-- 3) visit_audit_log: append-only trail for customer-facing visit actions —
--    soft visit_id reference on purpose (rows survive visit deletion),
--    mirroring calibration_request_audit_log.
-- Additive — no existing query is affected.
ALTER TABLE "calibration_visit" ADD COLUMN IF NOT EXISTS "customer_confirmed_by" text;--> statement-breakpoint
ALTER TABLE "calibration_visit" ADD COLUMN IF NOT EXISTS "customer_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calibration_visit" ADD CONSTRAINT "calibration_visit_customer_confirmed_by_user_id_fk" FOREIGN KEY ("customer_confirmed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "visit_reschedule_request" (
	"id" serial PRIMARY KEY NOT NULL,
	"visit_id" integer NOT NULL,
	"organization_id" text NOT NULL,
	"customer_id" integer NOT NULL,
	"requested_by" text NOT NULL,
	"reason" text,
	"preferred_windows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "visit_reschedule_request" ADD CONSTRAINT "visit_reschedule_request_visit_id_calibration_visit_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."calibration_visit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_reschedule_request" ADD CONSTRAINT "visit_reschedule_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_reschedule_request" ADD CONSTRAINT "visit_reschedule_request_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_reschedule_request" ADD CONSTRAINT "visit_reschedule_request_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_reschedule_request" ADD CONSTRAINT "visit_reschedule_request_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_reschedule_request_visit_idx" ON "visit_reschedule_request" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_reschedule_request_customer_idx" ON "visit_reschedule_request" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_reschedule_request_org_pending_idx" ON "visit_reschedule_request" USING btree ("organization_id","status") WHERE "visit_reschedule_request"."status" = 'PENDING';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "visit_reschedule_request_pending_uidx" ON "visit_reschedule_request" USING btree ("visit_id") WHERE "visit_reschedule_request"."status" = 'PENDING';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "visit_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"visit_id" integer NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"reason" text
);--> statement-breakpoint
ALTER TABLE "visit_audit_log" ADD CONSTRAINT "visit_audit_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_audit_log_visit_id_idx" ON "visit_audit_log" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_audit_log_performed_at_idx" ON "visit_audit_log" USING btree ("performed_at");
