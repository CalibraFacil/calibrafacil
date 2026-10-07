-- Bring-your-own Conta Azul application: a self-hosted server has no shared
-- OAuth app, so each laboratory registers its own on Conta Azul's developer
-- portal and pastes the credentials in Settings → Integrations. One row per
-- laboratory and provider; the secret is encrypted with INTEGRATIONS_MASTER_KEY.
-- Servers that set CONTA_AZUL_CLIENT_ID/SECRET keep using those as a fallback.
--
-- Idempotent, because this project applies migration DDL by hand and the
-- drizzle bookkeeping table lags behind it.
CREATE TABLE IF NOT EXISTS "integration_oauth_app" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "provider" text NOT NULL,
  "client_id" text NOT NULL,
  "encrypted_client_secret" text NOT NULL,
  "client_secret_iv" text NOT NULL,
  "client_secret_last4" text NOT NULL,
  "updated_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "integration_oauth_app"
    ADD CONSTRAINT "integration_oauth_app_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "integration_oauth_app"
    ADD CONSTRAINT "integration_oauth_app_updated_by_user_id_fk"
    FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "integration_oauth_app_org_provider_uidx"
  ON "integration_oauth_app" USING btree ("organization_id", "provider");
