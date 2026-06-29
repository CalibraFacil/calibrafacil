-- Installation-date anchor for the legal-metrology verification periodicity (deferred #2 of #423).
--
-- The regulated period `regulated_interval.kind = 'max_months_from_install'` (hidrômetros)
-- derives `next_legal_verification_date` = `installed_at` + valueMonths. Until now the asset
-- had no install date, so the ceiling could never be derived. This adds the nullable anchor.
--
-- Purely additive; NULL = unknown install date → no fabricated verification date
-- (REQ-INSTALL-003). IF NOT EXISTS keeps it safe to re-run on the drizzle meta.
ALTER TABLE "asset" ADD COLUMN IF NOT EXISTS "installed_at" timestamp;
