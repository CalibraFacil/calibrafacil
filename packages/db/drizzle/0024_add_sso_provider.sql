CREATE TABLE "sso_provider" (
  "id" text PRIMARY KEY NOT NULL,
  "issuer" text NOT NULL,
  "oidc_config" text,
  "saml_config" text,
  "user_id" text NOT NULL,
  "provider_id" text NOT NULL,
  "organization_id" text,
  "domain" text NOT NULL,
  "domain_verified" boolean DEFAULT false,
  CONSTRAINT "sso_provider_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
ALTER TABLE "sso_provider"
  ADD CONSTRAINT "sso_provider_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sso_provider"
  ADD CONSTRAINT "sso_provider_organization_id_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "sso_provider_user_id_idx"
  ON "sso_provider" ("user_id");
--> statement-breakpoint
CREATE INDEX "sso_provider_org_id_idx"
  ON "sso_provider" ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sso_provider_provider_id_uidx"
  ON "sso_provider" ("provider_id");
