INSERT INTO "organization_unit" (
  "organization_id",
  "name",
  "slug",
  "legal_name",
  "trade_name",
  "cnpj",
  "accreditation_number",
  "accreditation_body",
  "installation_type",
  "status",
  "is_default"
)
SELECT
  o."id",
  'Matriz',
  'matriz',
  o."name",
  o."name",
  o."cnpj",
  o."accreditation_number",
  o."accreditation_body",
  'PERMANENT',
  'ACTIVE',
  true
FROM "organization" o
WHERE NOT EXISTS (
  SELECT 1
  FROM "organization_unit" ou
  WHERE ou."organization_id" = o."id"
);
--> statement-breakpoint

ALTER TABLE "environmental_limits"
  ADD COLUMN "unit_id" integer;
--> statement-breakpoint
ALTER TABLE "organization_signing_certificate"
  ADD COLUMN "unit_id" integer;
--> statement-breakpoint

UPDATE "environmental_limits" el
SET "unit_id" = (
  SELECT ou."id"
  FROM "organization_unit" ou
  WHERE ou."organization_id" = el."organization_id"
  ORDER BY ou."is_default" DESC, ou."id" ASC
  LIMIT 1
)
WHERE el."unit_id" IS NULL;
--> statement-breakpoint

UPDATE "organization_signing_certificate" osc
SET "unit_id" = (
  SELECT ou."id"
  FROM "organization_unit" ou
  WHERE ou."organization_id" = osc."organization_id"
  ORDER BY ou."is_default" DESC, ou."id" ASC
  LIMIT 1
)
WHERE osc."unit_id" IS NULL;
--> statement-breakpoint

ALTER TABLE "environmental_limits"
  ALTER COLUMN "unit_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "organization_signing_certificate"
  ALTER COLUMN "unit_id" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "environmental_limits"
  ADD CONSTRAINT "environmental_limits_unit_id_organization_unit_id_fk"
  FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "organization_signing_certificate"
  ADD CONSTRAINT "organization_signing_certificate_unit_id_organization_unit_id_fk"
  FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "environmental_limits"
  DROP CONSTRAINT IF EXISTS "env_limits_org_asset_type_uidx";
--> statement-breakpoint
DROP INDEX IF EXISTS "env_limits_org_asset_type_uidx";
--> statement-breakpoint
CREATE INDEX "env_limits_unit_id_idx"
  ON "environmental_limits" USING btree ("unit_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "env_limits_org_unit_asset_type_uidx"
  ON "environmental_limits" USING btree ("organization_id", "unit_id", "asset_type_id") NULLS NOT DISTINCT;
--> statement-breakpoint

DROP INDEX IF EXISTS "org_signing_cert_is_default_idx";
--> statement-breakpoint
CREATE INDEX "org_signing_cert_unit_id_idx"
  ON "organization_signing_certificate" USING btree ("unit_id");
--> statement-breakpoint
CREATE INDEX "org_signing_cert_is_default_idx"
  ON "organization_signing_certificate" USING btree ("organization_id", "unit_id", "is_default");
