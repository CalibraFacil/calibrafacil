-- #427 Phase 1 — accredited-scope (CMC) guard enforcement.
-- Org-level guard mode ('warn' keeps Phase 0 behavior; 'enforce' blocks
-- accredited approval on scope violations), the documented-override column
-- frozen on the job (non-null = issuance downgraded to non-accredited, seal
-- suppressed), and org-level scope audit events (enforcement-mode changes)
-- that are not tied to a single line. Additive — no existing query affected.
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "scope_enforcement_mode" text DEFAULT 'warn' NOT NULL;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD COLUMN IF NOT EXISTS "scope_override_justification" text;--> statement-breakpoint
ALTER TABLE "accredited_scope_line_audit_log" ALTER COLUMN "scope_line_id" DROP NOT NULL;
