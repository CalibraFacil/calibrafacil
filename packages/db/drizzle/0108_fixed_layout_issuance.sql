-- Phase 3 of #865: the fixed system layouts now render certificates, so the
-- issued-certificate snapshot stops describing an XLSX workbook and starts
-- describing a layout.
--
-- ORDER: this one is safe to apply BEFORE its deploy. Everything it adds is
-- nullable, and everything it drops is XLSX-only — the currently deployed build
-- (post-0107) already stopped writing those three columns, because the renderer
-- that filled them is gone. Unlike the 0106/0107 pair there is no window where
-- the running build needs what this removes.
--
-- WHAT SURVIVES: exactly one historical row (job 29, CAL-2026-9001, the only
-- certificate this product has ever issued). Its XLSX provenance is not deleted
-- — it moves into `legacy_xlsx` so the row still describes how it was made. The
-- PDF bytes and `pdf_sha256` are untouched, so the immutability check in
-- docs/referencias/certificado-legado/README.md keeps passing.

-- ── the layout's identity, for reproducibility ──────────────────────────────
-- A certificate has to re-render identically years later. The PDF bytes are
-- already snapshotted; these three say WHICH renderer produced them, so a
-- future auditor can tell a byte difference caused by a layout change from one
-- caused by tampering.
ALTER TABLE "issued_certificate_snapshot"
  ADD COLUMN IF NOT EXISTS "layout_key" text,
  ADD COLUMN IF NOT EXISTS "layout_version" text,
  ADD COLUMN IF NOT EXISTS "renderer_version" text;

-- ── preserve the XLSX provenance instead of dropping it ─────────────────────
ALTER TABLE "issued_certificate_snapshot"
  ADD COLUMN IF NOT EXISTS "legacy_xlsx" jsonb;

UPDATE "issued_certificate_snapshot"
SET "legacy_xlsx" = jsonb_strip_nulls(
      jsonb_build_object(
        'filledXlsxR2Key', "filled_xlsx_r2_key",
        'filledXlsxSha256', "filled_xlsx_sha256",
        'bindingManifestSha256', "binding_manifest_sha256",
        'templateId', "template_id",
        'templateVersionId', "template_version_id"
      )
    )
WHERE "legacy_xlsx" IS NULL
  AND "filled_xlsx_r2_key" IS NOT NULL;

ALTER TABLE "issued_certificate_snapshot"
  DROP COLUMN IF EXISTS "filled_xlsx_r2_key",
  DROP COLUMN IF EXISTS "filled_xlsx_sha256",
  DROP COLUMN IF EXISTS "binding_manifest_sha256";

-- ── render_policy stops being XLSX-shaped ───────────────────────────────────
-- It used to hold `{"converter": "gotenberg-libreoffice", ...}` literally. The
-- column stays jsonb (the historical row keeps its own value verbatim); only
-- the type that reads it changes, in packages/db/src/schema.ts. Newly issued
-- rows describe the Chromium route instead. Nullable from here on: the policy
-- is a property of the render, and there is nothing to record before one runs.
ALTER TABLE "issued_certificate_snapshot"
  ALTER COLUMN "render_policy" DROP NOT NULL;

-- ── the lab-authored template tables ────────────────────────────────────────
-- 0107 kept these because they held the R2 keys of a lab's 15 template versions
-- and the archive copy had not been made. They are dropped here.
--
-- OPERATOR PRECONDITION: copy the 9 blobs listed in
-- docs/referencias/certificado-legado/inventario-r2.md to archive/ in the
-- PRODUCTION R2 bucket first. Once these tables are gone, the mapping from
-- template version to R2 key survives only in that markdown file.
--
-- The FKs from issued_certificate_snapshot were already dropped in 0107, so
-- nothing references these any more.
DROP TABLE IF EXISTS "certificate_template_version";
DROP TABLE IF EXISTS "certificate_template";
