CREATE TABLE "oot_notification" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"nc_id" integer NOT NULL,
	"job_id" integer NOT NULL,
	"certificate_number" text,
	"recipient_name" text,
	"recipient_email" text,
	"affected_scope" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"pdf_r2_key" text,
	"pdf_sha256" text,
	"sent_at" timestamp,
	"ack_token" text DEFAULT gen_random_uuid() NOT NULL,
	"acknowledged_at" timestamp,
	"acknowledged_via" text,
	"acknowledged_note" text,
	"approved_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oot_notification_ack_token_unique" UNIQUE("ack_token")
);
--> statement-breakpoint
CREATE TABLE "oot_email_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"notification_id" integer NOT NULL,
	"event_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"dead_letter_at" timestamp,
	"claimed_at" timestamp,
	CONSTRAINT "oot_email_outbox_notification_event_uidx" UNIQUE("notification_id","event_key")
);
--> statement-breakpoint
ALTER TABLE "non_conformance" ADD COLUMN "trigger_source" text;--> statement-breakpoint
ALTER TABLE "oot_notification" ADD CONSTRAINT "oot_notification_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oot_notification" ADD CONSTRAINT "oot_notification_nc_id_non_conformance_id_fk" FOREIGN KEY ("nc_id") REFERENCES "public"."non_conformance"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oot_notification" ADD CONSTRAINT "oot_notification_job_id_calibration_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."calibration_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oot_notification" ADD CONSTRAINT "oot_notification_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oot_email_outbox" ADD CONSTRAINT "oot_email_outbox_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oot_email_outbox" ADD CONSTRAINT "oot_email_outbox_notification_id_oot_notification_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."oot_notification"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oot_notification_organization_id_idx" ON "oot_notification" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "oot_notification_nc_id_idx" ON "oot_notification" USING btree ("nc_id");--> statement-breakpoint
CREATE INDEX "oot_notification_job_id_idx" ON "oot_notification" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "oot_notification_status_idx" ON "oot_notification" USING btree ("status");--> statement-breakpoint
CREATE INDEX "oot_email_outbox_pending_idx" ON "oot_email_outbox" USING btree ("created_at","processed_at");
