-- Authorized signatory (ISO/IEC 17025:2017 Clause 6.2.6) — who may APPROVE / sign
-- off calibration certificates, optionally scoped per asset type. Distinct from
-- personnel_competence (who may EXECUTE a calibration). Enforcement on approval is
-- auto-detected: skipped when the org has zero signatory records, enforced once
-- populated. assetTypeId NULL = org-wide signatory (all scopes). Additive.
CREATE TABLE IF NOT EXISTS "authorized_signatory" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"asset_type_id" integer,
	"scope_description" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"authorized_by" text NOT NULL,
	"authorized_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"revoked_by" text,
	"revoked_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "authorized_signatory_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"signatory_id" integer NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"reason" text
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "authorized_signatory" ADD CONSTRAINT "authorized_signatory_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "authorized_signatory" ADD CONSTRAINT "authorized_signatory_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "authorized_signatory" ADD CONSTRAINT "authorized_signatory_asset_type_id_asset_type_id_fk" FOREIGN KEY ("asset_type_id") REFERENCES "public"."asset_type"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "authorized_signatory" ADD CONSTRAINT "authorized_signatory_authorized_by_user_id_fk" FOREIGN KEY ("authorized_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "authorized_signatory" ADD CONSTRAINT "authorized_signatory_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "authorized_signatory_audit_log" ADD CONSTRAINT "authorized_signatory_audit_log_signatory_id_authorized_signatory_id_fk" FOREIGN KEY ("signatory_id") REFERENCES "public"."authorized_signatory"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "authorized_signatory_organization_id_idx" ON "authorized_signatory" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "authorized_signatory_user_id_idx" ON "authorized_signatory" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "authorized_signatory_asset_type_id_idx" ON "authorized_signatory" USING btree ("asset_type_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "authorized_signatory_status_idx" ON "authorized_signatory" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "authorized_signatory_expires_at_idx" ON "authorized_signatory" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "authorized_signatory_org_user_asset_type_uidx" ON "authorized_signatory" USING btree ("organization_id","user_id","asset_type_id") NULLS NOT DISTINCT;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "authorized_signatory_audit_log_signatory_id_idx" ON "authorized_signatory_audit_log" USING btree ("signatory_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "authorized_signatory_audit_log_performed_at_idx" ON "authorized_signatory_audit_log" USING btree ("performed_at");
