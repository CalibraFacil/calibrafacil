-- Accent-insensitive customer search ("construcao" matches "construção").
--
-- `unaccent` is STABLE (not IMMUTABLE), so it can't be used directly in an index
-- expression. The `immutable_unaccent` wrapper pins the dictionary, which makes it
-- safe to mark IMMUTABLE — that's what lets us index `lower(immutable_unaccent(...))`.
--
-- The search runs `... LIKE '%term%'` (leading wildcard), which a btree index can't
-- serve — so the acceleration is a pg_trgm GIN index over the unaccented, lowercased
-- name / trade name. Storage stays the canonical RFB value; only matching is normalized.
--
-- Forward-only and idempotent (IF NOT EXISTS / CREATE OR REPLACE).
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Both the function and the dictionary are schema-qualified (`public.`) so the wrapper
-- resolves regardless of search_path — index builds run with a restricted path that omits
-- public. The dictionary is pinned via an explicit `regdictionary` cast, which is what makes
-- the wrapper deterministic enough to mark IMMUTABLE. (The bare 2-arg `unaccent('unaccent',$1)`
-- form fails on PG17: no implicit unknown→regdictionary coercion.)
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

CREATE INDEX IF NOT EXISTS "customer_name_unaccent_trgm_idx"
  ON "customer" USING gin (lower(immutable_unaccent("name")) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "customer_trade_name_unaccent_trgm_idx"
  ON "customer" USING gin (lower(immutable_unaccent("trade_name")) gin_trgm_ops);
