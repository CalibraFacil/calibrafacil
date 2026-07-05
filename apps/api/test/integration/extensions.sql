-- DB-level objects that live in migrations (not the Drizzle schema) and so are NOT
-- created by `drizzle-kit push`. The integration template DB is push-built, so we apply
-- them here to keep it faithful to prod. Mirrors migration 0071 (extensions + the
-- IMMUTABLE unaccent wrapper used by accent-insensitive customer search). The GIN indexes
-- themselves are omitted: tests don't need them, only the function must resolve.
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

-- Mirrors migration 0083 (CMP-07 #692 rework): drizzle-orm/drizzle-kit cannot
-- express a PARTIAL unique index with NULLS NOT DISTINCT from schema.ts (see
-- 0083's comment for the full explanation), so `drizzle-kit push` only creates
-- an approximate (non-partial, nulls-distinct) version of these two indexes.
-- Replace them here with the true DDL so the push-built template DB matches
-- prod: tombstoned rows (user_id NULL, after a user's beforeDelete hook) are
-- exempt from the uniqueness check, while NULLS NOT DISTINCT is kept for
-- ACTIVE (user_id IS NOT NULL) rows (one org-wide row per user).
ALTER TABLE "personnel_competence" DROP CONSTRAINT IF EXISTS "competence_org_user_asset_type_uidx";
DROP INDEX IF EXISTS "competence_org_user_asset_type_uidx";
CREATE UNIQUE INDEX IF NOT EXISTS "competence_org_user_asset_type_uidx" ON "personnel_competence" USING btree ("organization_id","user_id","asset_type_id") NULLS NOT DISTINCT WHERE "user_id" IS NOT NULL;

ALTER TABLE "authorized_signatory" DROP CONSTRAINT IF EXISTS "authorized_signatory_org_user_asset_type_uidx";
DROP INDEX IF EXISTS "authorized_signatory_org_user_asset_type_uidx";
CREATE UNIQUE INDEX IF NOT EXISTS "authorized_signatory_org_user_asset_type_uidx" ON "authorized_signatory" USING btree ("organization_id","user_id","asset_type_id") NULLS NOT DISTINCT WHERE "user_id" IS NOT NULL;
