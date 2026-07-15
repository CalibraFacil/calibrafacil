-- #584 Lab-owned email sending domain (white-label transactional email).
-- One row per lab org. BYOK model: the lab's own Resend API key is stored
-- AES-256-GCM encrypted (EMAIL_DOMAIN_MASTER_KEY); only the last 4 chars are
-- ever exposed. `mode` keeps the future shared-account "managed" switch a data
-- change. `status` mirrors Resend's domain-status vocabulary; `key_status`
-- tracks credential health so sends can fall back to the platform sender.
-- Additive — no existing query is affected.
CREATE TABLE IF NOT EXISTS "organization_email_domain" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"mode" text DEFAULT 'byok' NOT NULL,
	"hostname" text NOT NULL,
	"resend_domain_id" text NOT NULL,
	"resend_api_key_encrypted" text NOT NULL,
	"resend_api_key_iv" text NOT NULL,
	"resend_api_key_last4" text NOT NULL,
	"from_address" text NOT NULL,
	"dns_records" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp,
	"last_verified_at" timestamp,
	"activated_at" timestamp,
	"is_active" boolean DEFAULT false NOT NULL,
	"key_status" text DEFAULT 'ok' NOT NULL,
	"key_last_error" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "organization_email_domain" ADD CONSTRAINT "organization_email_domain_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_email_domain" ADD CONSTRAINT "organization_email_domain_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_email_domain_org_uidx" ON "organization_email_domain" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_email_domain_hostname_uidx" ON "organization_email_domain" USING btree ("hostname");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_email_domain_active_idx" ON "organization_email_domain" USING btree ("is_active");
