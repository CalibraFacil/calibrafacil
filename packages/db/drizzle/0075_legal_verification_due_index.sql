-- Partial index for the worker's legal-verification recall sweep
-- (checkAssetsDueForLegalVerification): filters
--   metrology_regime = 'LEGAL' AND next_legal_verification_date BETWEEN ...
-- LEGAL instruments are a small slice of the asset table, so a partial index
-- keeps the sweep off a full scan as legal-metrology fleets grow.
CREATE INDEX IF NOT EXISTS "asset_legal_verification_due_idx"
  ON "asset" ("next_legal_verification_date")
  WHERE "metrology_regime" = 'LEGAL';
