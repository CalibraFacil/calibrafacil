-- #644 (CMP-01): per-unit signing policy. When true, certificate emission
-- FAILS (job REJECTED) if no active signing certificate is configured, instead
-- of silently emitting unsigned. Default false preserves current behavior.
ALTER TABLE "organization_unit" ADD COLUMN "require_signature" boolean NOT NULL DEFAULT false;
