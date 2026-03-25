ALTER TABLE "sso_provider"
  ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "sso_provider"
  ADD CONSTRAINT "sso_provider_organization_id_unique" UNIQUE("organization_id");
--> statement-breakpoint
DROP INDEX IF EXISTS "sso_provider_provider_id_uidx";
