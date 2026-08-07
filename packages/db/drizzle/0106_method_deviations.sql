-- ISO/IEC 17025 §7.8.2.1(n): "additions to, deviations, or exclusions from the
-- method" must appear on the report. The product had nowhere to record it —
-- see docs/referencias/iso-17025-7.8-conteudo.md.
--
-- Deliberately a separate column rather than reusing either neighbour:
--   * scope_override_justification answers "why was the seal suppressed" (#427)
--   * environmental_snapshot.outOfLimitsJustification answers "why were the
--     ambient conditions outside the configured limits"
-- Conflating any of the three would print the wrong sentence under the wrong
-- heading on a regulated document.
--
-- ORDER MATTERS, and this must stay BEFORE 0107 (the template drops).
-- 0107 is destructive and can only run AFTER the template-free build is live,
-- because the previous build still selects the columns it drops. This one is
-- additive and must run BEFORE that build, because the new build selects
-- method_deviations. With the drops numbered first there was no safe rolling
-- order at all: migrating to 0107 would necessarily apply the drops while the
-- old API was still serving. Additive first, deploy, then destructive.
--
-- Nullable and with no default: the overwhelmingly common case is a calibration
-- executed exactly per method, and §7.8.2.1 only requires the item to appear
-- when there is something to declare.

ALTER TABLE "calibration_job"
  ADD COLUMN IF NOT EXISTS "method_deviations" text;
