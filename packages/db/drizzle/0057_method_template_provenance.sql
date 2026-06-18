-- Provenance for methods created from a curated template (packages/method-templates).
-- `template_key` is the template's stable key (e.g. "mass-balance"); `template_version`
-- is the repo-owned template version that was adopted. Both nullable: methods authored
-- from scratch keep them NULL. Informational ONLY — deliberately excluded from the method
-- fingerprint, so adopting or upgrading a template never perturbs reproducibility or
-- locked job snapshots.
-- (IF NOT EXISTS keeps this safe to re-run on the drizzle meta in its current state.)
ALTER TABLE "calibration_method" ADD COLUMN IF NOT EXISTS "template_key" text;
ALTER TABLE "calibration_method" ADD COLUMN IF NOT EXISTS "template_version" integer;
