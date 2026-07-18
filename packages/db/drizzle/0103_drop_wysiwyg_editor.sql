-- Remove the visual (wysiwyg) certificate editor from the database.
-- Reverses migrations 0101 (engine discriminator + document columns) and 0102
-- (org media library) after the editor itself was deleted from the codebase.
--
-- APPLY ONLY AFTER the wysiwyg-free API/worker build is live: the previous
-- build still SELECTs the columns dropped below.
--
-- Verified on development + production before authoring: 0 issued certificates
-- were ever produced by the wysiwyg engine and 0 rows exist in
-- organization_media, so nothing regulated is touched. The only wysiwyg rows
-- are unassigned DRAFT template versions in the CalibraFácil test org.

-- 1. Previews of editor-only versions (FK: preview -> version).
DELETE FROM "certificate_template_preview"
WHERE "template_version_id" IN (
  SELECT "id" FROM "certificate_template_version" WHERE "engine" = 'wysiwyg'
);--> statement-breakpoint

-- 2. Assignments pointing at editor-only versions (none today; belt and braces).
DELETE FROM "certificate_template_assignment"
WHERE "template_version_id" IN (
  SELECT "id" FROM "certificate_template_version" WHERE "engine" = 'wysiwyg'
);--> statement-breakpoint

-- 3. Templates whose ONLY versions were editor documents: they exist solely to
--    hold one, so the template goes with it (versions cascade).
DELETE FROM "certificate_template" t
WHERE EXISTS (
  SELECT 1 FROM "certificate_template_version" v
  WHERE v."template_id" = t."id" AND v."engine" = 'wysiwyg'
)
AND NOT EXISTS (
  SELECT 1 FROM "certificate_template_version" v
  WHERE v."template_id" = t."id" AND v."engine" <> 'wysiwyg'
);--> statement-breakpoint

-- 4. Any editor version left on a template that also has XLSX versions.
DELETE FROM "certificate_template_version" WHERE "engine" = 'wysiwyg';--> statement-breakpoint

-- 5. Drop the engine discriminator, its CHECKs and the document/HTML columns,
--    restoring the pre-0101 NOT NULLs now that only XLSX rows remain.
ALTER TABLE "certificate_template_version" DROP CONSTRAINT IF EXISTS "ctv_engine_payload_check";--> statement-breakpoint
ALTER TABLE "certificate_template_version" DROP COLUMN IF EXISTS "engine";--> statement-breakpoint
ALTER TABLE "certificate_template_version" DROP COLUMN IF EXISTS "document_json";--> statement-breakpoint
ALTER TABLE "certificate_template_version" DROP COLUMN IF EXISTS "document_sha256";--> statement-breakpoint
ALTER TABLE "certificate_template_version" ALTER COLUMN "xlsx_r2_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "certificate_template_version" ALTER COLUMN "xlsx_sha256" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "certificate_template_version" ALTER COLUMN "binding_manifest" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "certificate_template_version" ALTER COLUMN "binding_manifest_sha256" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "issued_certificate_snapshot" DROP CONSTRAINT IF EXISTS "ics_engine_artifact_check";--> statement-breakpoint
ALTER TABLE "issued_certificate_snapshot" DROP COLUMN IF EXISTS "engine";--> statement-breakpoint
ALTER TABLE "issued_certificate_snapshot" DROP COLUMN IF EXISTS "compiled_html_r2_key";--> statement-breakpoint
ALTER TABLE "issued_certificate_snapshot" DROP COLUMN IF EXISTS "compiled_html_sha256";--> statement-breakpoint
ALTER TABLE "issued_certificate_snapshot" ALTER COLUMN "filled_xlsx_r2_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "issued_certificate_snapshot" ALTER COLUMN "filled_xlsx_sha256" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "issued_certificate_snapshot" ALTER COLUMN "binding_manifest_sha256" SET NOT NULL;--> statement-breakpoint

-- 6. The editor's image library.
DROP TABLE IF EXISTS "organization_media";
