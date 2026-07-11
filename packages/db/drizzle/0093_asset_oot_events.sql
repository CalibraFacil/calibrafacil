CREATE TABLE "asset_oot_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"lab_organization_id" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"detected_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "asset_oot_event_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "asset_oot_impact_assessment" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"decision" text NOT NULL,
	"rationale" text NOT NULL,
	"affected_period_start" timestamp,
	"affected_period_end" timestamp,
	"suspect_product_shipped" boolean,
	"customer_notified" boolean,
	"portal_user_id" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_oot_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text
);
--> statement-breakpoint
ALTER TABLE "asset_oot_event" ADD CONSTRAINT "asset_oot_event_job_id_calibration_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."calibration_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_oot_event" ADD CONSTRAINT "asset_oot_event_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_oot_event" ADD CONSTRAINT "asset_oot_event_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_oot_event" ADD CONSTRAINT "asset_oot_event_lab_organization_id_organization_id_fk" FOREIGN KEY ("lab_organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_oot_impact_assessment" ADD CONSTRAINT "asset_oot_impact_assessment_event_id_asset_oot_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."asset_oot_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_oot_impact_assessment" ADD CONSTRAINT "asset_oot_impact_assessment_portal_user_id_user_id_fk" FOREIGN KEY ("portal_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_oot_audit_log" ADD CONSTRAINT "asset_oot_audit_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_oot_event_customer_status_idx" ON "asset_oot_event" USING btree ("customer_id","status");--> statement-breakpoint
CREATE INDEX "asset_oot_event_asset_id_idx" ON "asset_oot_event" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_oot_event_lab_org_idx" ON "asset_oot_event" USING btree ("lab_organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_oot_impact_assessment_event_uidx" ON "asset_oot_impact_assessment" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "asset_oot_audit_log_event_id_idx" ON "asset_oot_audit_log" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "asset_oot_audit_log_performed_at_idx" ON "asset_oot_audit_log" USING btree ("performed_at");
