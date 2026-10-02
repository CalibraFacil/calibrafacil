-- Database objects that live only in migrations because src/schema.ts cannot
-- express them, so `drizzle-kit push` does not create them. Applied by
-- `pnpm --dir packages/db db:bootstrap` right after pushing the schema into a new
-- database. Every statement is idempotent.
--
-- Keep this file in sync whenever a migration adds an object of this kind
-- (extension, function, partial/expression index, CHECK constraint).

-- Accent-insensitive search (migration 0071).
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

CREATE INDEX IF NOT EXISTS customer_name_unaccent_trgm_idx
  ON public.customer USING gin (lower(immutable_unaccent(name)) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customer_trade_name_unaccent_trgm_idx
  ON public.customer USING gin (lower(immutable_unaccent(trade_name)) gin_trgm_ops);

-- Partial unique indexes with NULLS NOT DISTINCT (migration 0083): schema.ts can
-- only describe an approximate, non-partial version, which push creates first.
ALTER TABLE personnel_competence DROP CONSTRAINT IF EXISTS competence_org_user_asset_type_uidx;
DROP INDEX IF EXISTS competence_org_user_asset_type_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS competence_org_user_asset_type_uidx
  ON public.personnel_competence USING btree (organization_id, user_id, asset_type_id)
  NULLS NOT DISTINCT WHERE (user_id IS NOT NULL);

ALTER TABLE authorized_signatory DROP CONSTRAINT IF EXISTS authorized_signatory_org_user_asset_type_uidx;
DROP INDEX IF EXISTS authorized_signatory_org_user_asset_type_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS authorized_signatory_org_user_asset_type_uidx
  ON public.authorized_signatory USING btree (organization_id, user_id, asset_type_id)
  NULLS NOT DISTINCT WHERE (user_id IS NOT NULL);

-- One current certificate document per reference standard (migration 0023).
CREATE UNIQUE INDEX IF NOT EXISTS standard_certificate_document_one_current_uidx
  ON public.reference_standard_certificate_document USING btree (standard_id)
  WHERE (is_current = true);

-- One organization-wide default release policy / automatic-send rule
-- (migrations 0029 and 0031).
CREATE UNIQUE INDEX IF NOT EXISTS certificate_release_policy_org_default_uidx
  ON public.certificate_release_policy USING btree (organization_id)
  WHERE ((customer_id IS NULL) AND (commercial_agreement_id IS NULL)
    AND (service_category IS NULL) AND (archived_at IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS automatic_send_rule_org_default_uidx
  ON public.automatic_send_rule USING btree (organization_id)
  WHERE ((customer_id IS NULL) AND (commercial_agreement_id IS NULL)
    AND (service_category IS NULL) AND (archived_at IS NULL));

-- Accredited-scope expiry lookups (migration 0100).
CREATE INDEX IF NOT EXISTS accredited_scope_line_valid_until_idx
  ON public.accredited_scope_line USING btree (valid_until)
  WHERE (valid_until IS NOT NULL);

-- Key custody per sending mode (migration 0110).
ALTER TABLE organization_email_domain
  DROP CONSTRAINT IF EXISTS organization_email_domain_mode_key_custody;
ALTER TABLE organization_email_domain
  ADD CONSTRAINT organization_email_domain_mode_key_custody CHECK (
    (
      mode = 'byok'
      AND resend_api_key_encrypted IS NOT NULL
      AND resend_api_key_iv IS NOT NULL
      AND resend_api_key_last4 IS NOT NULL
    )
    OR (
      mode = 'managed'
      AND resend_api_key_encrypted IS NULL
      AND resend_api_key_iv IS NULL
      AND resend_api_key_last4 IS NULL
    )
  );
