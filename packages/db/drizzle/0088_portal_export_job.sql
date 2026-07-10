CREATE TABLE "portal_export_job" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'AUDIT_PACK' NOT NULL,
	"lab_organization_id" text NOT NULL,
	"auth_organization_id" text NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"params" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"certificate_count" integer,
	"included_job_ids" jsonb,
	"r2_key" text,
	"file_size_bytes" integer,
	"failure_reason" text,
	"expires_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portal_export_job" ADD CONSTRAINT "portal_export_job_lab_organization_id_organization_id_fk" FOREIGN KEY ("lab_organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_export_job" ADD CONSTRAINT "portal_export_job_auth_organization_id_organization_id_fk" FOREIGN KEY ("auth_organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_export_job" ADD CONSTRAINT "portal_export_job_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portal_export_job_auth_org_idx" ON "portal_export_job" USING btree ("auth_organization_id","created_at");--> statement-breakpoint
CREATE INDEX "portal_export_job_lab_org_idx" ON "portal_export_job" USING btree ("lab_organization_id");--> statement-breakpoint
CREATE INDEX "portal_export_job_status_idx" ON "portal_export_job" USING btree ("status");
