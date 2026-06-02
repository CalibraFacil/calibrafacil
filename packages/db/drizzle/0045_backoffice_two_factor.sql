-- Mandatory two-factor authentication for the internal operations surface
-- (apps/backoffice). Adds the Better Auth `twoFactor` plugin store — the per-user
-- TOTP secret + encrypted backup codes — plus the `two_factor_enabled` flag on the
-- shared user table. Only the backoffice auth instance mounts the plugin, but the
-- columns/table are shared like the other auth tables. Additive: lab and portal
-- sign-in are unaffected because those instances don't load the plugin.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "two_factor_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "twoFactor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "twoFactor" ADD CONSTRAINT "twoFactor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "two_factor_user_id_idx" ON "twoFactor" USING btree ("user_id");
