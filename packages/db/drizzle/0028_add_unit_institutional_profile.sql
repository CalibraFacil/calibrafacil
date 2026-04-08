ALTER TABLE "organization_unit"
  ADD COLUMN "legal_name" text,
  ADD COLUMN "trade_name" text,
  ADD COLUMN "cnpj" text,
  ADD COLUMN "accreditation_number" text,
  ADD COLUMN "accreditation_body" text,
  ADD COLUMN "installation_type" text DEFAULT 'PERMANENT' NOT NULL,
  ADD COLUMN "street" text,
  ADD COLUMN "number" text,
  ADD COLUMN "complement" text,
  ADD COLUMN "neighbourhood" text,
  ADD COLUMN "city" text,
  ADD COLUMN "state" text,
  ADD COLUMN "cep" text,
  ADD COLUMN "phone" text,
  ADD COLUMN "email" text,
  ADD COLUMN "website" text,
  ADD COLUMN "technical_manager_name" text,
  ADD COLUMN "technical_manager_title" text,
  ADD COLUMN "scope_summary" text,
  ADD COLUMN "scope_notes" text;
--> statement-breakpoint

UPDATE "organization_unit" AS ou
SET
  "legal_name" = o."name",
  "trade_name" = o."name",
  "cnpj" = o."cnpj",
  "accreditation_number" = o."accreditation_number",
  "accreditation_body" = o."accreditation_body",
  "street" = o."street",
  "number" = o."number",
  "complement" = o."complement",
  "neighbourhood" = o."neighbourhood",
  "city" = o."city",
  "state" = o."state",
  "cep" = o."cep",
  "phone" = o."phone",
  "email" = o."email",
  "website" = o."website",
  "technical_manager_name" = o."technical_manager_name",
  "technical_manager_title" = o."technical_manager_title"
FROM "organization" AS o
WHERE ou."organization_id" = o."id"
  AND ou."is_default" = true;
