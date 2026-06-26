-- Legal-metrology repair authorization (RBMLQ-I "oficina permissionária").
-- Two additive columns on organization, distinct from the RBC/CGCRE accreditation
-- fields: the permissionária authorization number and its UF (sigla do estado).
-- Required on repair OS documents for instruments subject to legal metrology
-- (Port. Inmetro 65/2015 + NIT-Dicol-002). Existing rows are unaffected (NULL).
-- (IF NOT EXISTS keeps this safe to re-run on the drizzle meta in its current state.)
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "permissionaria_authorization_number" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "permissionaria_authorization_state" text;
