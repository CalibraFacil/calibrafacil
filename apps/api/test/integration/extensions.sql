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
