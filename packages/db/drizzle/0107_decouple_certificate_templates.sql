-- Decouple the schema from lab-authored certificate templates (#865, Fase 1).
--
-- DELIBERATELY NOT A FULL DROP. `certificate_template` and
-- `certificate_template_version` STAY: they hold the R2 keys of the 9 distinct
-- XLSX blobs that ever existed, and the single row in
-- `issued_certificate_snapshot` points at template 3 / version 15. Dropping
-- them now would destroy the provenance of an issued, signed certificate.
-- The drop is migration 0108 (Fase 3), only after the blobs are copied to the
-- `archive/` prefix in the production media bucket — see
-- docs/referencias/certificado-legado/inventario-r2.md.
--
-- ⚠ DO NOT APPLY THIS IN THE SAME RUN AS 0106.
-- `pnpm db:migrate` (and the manual db-migrate.yml workflow, which shells out
-- to it) applies every pending journal entry in one pass. With both pending
-- that pass drops calibration_method.certificate_template_id while the
-- PREVIOUS build is still serving, and every method/job read 42703s until the
-- deploy lands. The sequence is: apply 0106 -> deploy -> apply 0107, with 0107
-- applied by hand. Nothing in the tooling enforces this; the order is the
-- operator's to hold.
--
-- Runs AFTER 0106 (additive) on purpose — see the note there for why the
-- additive column has to precede these drops for a rolling deploy to exist.
--
-- APPLY ONLY AFTER the template-free API/worker build is live: the previous
-- build still SELECTs `calibration_method.certificate_template_id` and
-- `calibration_job.certificate_template_id`.
--
-- Verified on production before authoring: 1 issued snapshot, 1 method linked,
-- 1 job carrying a template id, 19 template previews, and 22 jobs carrying a
-- frozen `certificate_template_snapshot`. Those 22 snapshots are kept.

-- 1. Release the issued snapshot from the template tables. The integer columns
--    stay as a historical pointer (nullable, no FK) so the provenance of the
--    already-issued certificate survives the 0108 drop. ON DELETE RESTRICT is
--    exactly what would block that drop, so it has to go first.
ALTER TABLE "issued_certificate_snapshot"
  DROP CONSTRAINT IF EXISTS "issued_certificate_snapshot_template_id_certificate_template_id";--> statement-breakpoint
ALTER TABLE "issued_certificate_snapshot"
  DROP CONSTRAINT IF EXISTS "issued_certificate_snapshot_template_version_id_certificate_tem";--> statement-breakpoint
ALTER TABLE "issued_certificate_snapshot"
  ALTER COLUMN "template_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "issued_certificate_snapshot"
  ALTER COLUMN "template_version_id" DROP NOT NULL;--> statement-breakpoint

-- 2. Mark which renderer produced each snapshot. Everything that exists today
--    came from the XLSX pipeline; Fase 3 writes the fixed-layout identity
--    (layout_key / layout_version / renderer_version) in 0108.
ALTER TABLE "issued_certificate_snapshot"
  ADD COLUMN IF NOT EXISTS "render_pipeline" text DEFAULT 'XLSX_LEGACY' NOT NULL;--> statement-breakpoint

-- 3. Previews are ephemeral by construction (they carry `expires_at` and are
--    regenerated on demand), and the editor that produced them is gone.
--    Nothing regulated is lost.
DROP TABLE IF EXISTS "certificate_template_preview";--> statement-breakpoint

-- 4. The per-method template link. Issuance no longer resolves a template from
--    the method — the fixed layout is chosen from the method's quantity.
DROP INDEX IF EXISTS "method_certificate_template_id_idx";--> statement-breakpoint
ALTER TABLE "calibration_method"
  DROP COLUMN IF EXISTS "certificate_template_id";--> statement-breakpoint

-- 5. The per-job template link. NOTE the asymmetry: the id goes, but
--    `calibration_job.certificate_template_snapshot` STAYS. The id is a live
--    foreign key into a table being retired; the snapshot is a frozen record of
--    what an approved job was issued with (22 rows in production) and is
--    regulated evidence, not a link.
DROP INDEX IF EXISTS "job_certificate_template_id_idx";--> statement-breakpoint
ALTER TABLE "calibration_job"
  DROP COLUMN IF EXISTS "certificate_template_id";
