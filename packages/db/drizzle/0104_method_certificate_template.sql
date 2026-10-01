-- Per-method certificate template (replaces scope/priority assignments).
-- Each calibration_method owns an explicit link to the certificate template it
-- issues with; the worker renders that template's latest PUBLISHED version and
-- job approval blocks while the link is null.
--
-- ADDITIVE — safe to apply BEFORE the deploy that reads it. The companion
-- migration 0105 (drops certificate_template_assignment) must only run AFTER
-- the new build is live, since the old build's resolver still queries it.

ALTER TABLE "calibration_method" ADD COLUMN "certificate_template_id" integer;--> statement-breakpoint
ALTER TABLE "calibration_method" ADD CONSTRAINT "calibration_method_certificate_template_id_certificate_template_id_fk"
  FOREIGN KEY ("certificate_template_id") REFERENCES "public"."certificate_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "method_certificate_template_id_idx" ON "calibration_method" USING btree ("certificate_template_id");--> statement-breakpoint

-- Backfill 1: method-scoped ACTIVE assignments map directly onto the method.
-- Ties resolve exactly like the old resolver did (priority desc, created_at desc).
-- Verified state on 2026-07-19: 4 ACTIVE assignments, all for one lab and
-- method, so this UPDATE is the whole story.
UPDATE "calibration_method" m
SET "certificate_template_id" = picked.template_id
FROM (
  SELECT DISTINCT ON (a."method_id") a."method_id", a."template_id"
  FROM "certificate_template_assignment" a
  WHERE a."status" = 'ACTIVE' AND a."method_id" IS NOT NULL
  ORDER BY a."method_id", a."priority" DESC, a."created_at" DESC
) picked
WHERE m."id" = picked."method_id" AND m."certificate_template_id" IS NULL;--> statement-breakpoint

-- Backfill 2 (defensive; matches no row today): orgs whose only ACTIVE
-- assignments are method-wildcards point every method of the org at the org's
-- top assignment, mirroring the old wildcard fallback.
UPDATE "calibration_method" m
SET "certificate_template_id" = picked.template_id
FROM (
  SELECT DISTINCT ON (a."organization_id") a."organization_id", a."template_id"
  FROM "certificate_template_assignment" a
  WHERE a."status" = 'ACTIVE' AND a."method_id" IS NULL
  ORDER BY a."organization_id", a."priority" DESC, a."created_at" DESC
) picked
WHERE m."organization_id" = picked."organization_id"
  AND m."certificate_template_id" IS NULL;
