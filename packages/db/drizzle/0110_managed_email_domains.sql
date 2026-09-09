-- Managed sending domains: we create the domain in our own Resend account and
-- the laboratory only publishes DNS.
--
-- Bring-your-own-key rows keep working untouched. One exists in production and
-- is not in active use, so nothing is migrated here: the read path stays for
-- safety and costs a dozen lines. What changes is that no NEW row is ever
-- created with a key, so the three key columns must be nullable.
--
-- Idempotent, because this project applies migration DDL by hand and the
-- drizzle bookkeeping table lags behind it.
ALTER TABLE "organization_email_domain"
  ALTER COLUMN "resend_api_key_encrypted" DROP NOT NULL,
  ALTER COLUMN "resend_api_key_iv" DROP NOT NULL,
  ALTER COLUMN "resend_api_key_last4" DROP NOT NULL;

ALTER TABLE "organization_email_domain"
  ALTER COLUMN "mode" SET DEFAULT 'managed';

-- The two modes are mutually exclusive about key custody, and a row that gets
-- this wrong fails at send time rather than at write time. Enforce it here.
ALTER TABLE "organization_email_domain"
  DROP CONSTRAINT IF EXISTS "organization_email_domain_mode_key_custody";

ALTER TABLE "organization_email_domain"
  ADD CONSTRAINT "organization_email_domain_mode_key_custody" CHECK (
    (
      "mode" = 'byok'
      AND "resend_api_key_encrypted" IS NOT NULL
      AND "resend_api_key_iv" IS NOT NULL
      AND "resend_api_key_last4" IS NOT NULL
    )
    OR (
      "mode" = 'managed'
      AND "resend_api_key_encrypted" IS NULL
      AND "resend_api_key_iv" IS NULL
      AND "resend_api_key_last4" IS NULL
    )
  );
