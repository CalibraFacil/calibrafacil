-- Drop the deprecated `subject_to_legal_metrology` boolean (deferred item #6, FINAL, of #423).
--
-- The boolean was kept in lock-step with `metrology_regime` during the transition (0066
-- backfilled it as `regime = 'LEGAL'` and every write kept the two consistent). All reads
-- have now migrated to `metrology_regime = 'LEGAL'`, so the column is removed.
--
-- Forward-only and idempotent: IF EXISTS keeps it safe to re-run on the drizzle meta.
ALTER TABLE "asset" DROP COLUMN IF EXISTS "subject_to_legal_metrology";
