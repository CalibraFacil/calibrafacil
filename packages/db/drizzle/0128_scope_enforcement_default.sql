-- Scope enforcement defaults to `enforce` for accredited labs (decision Q45, P0-7).
--
-- `organization.scope_enforcement_mode` was `text DEFAULT 'warn' NOT NULL` (migration
-- 0099): every lab, accredited or not, started in `warn`, so an out-of-scope or
-- below-CMC result was approved (and, before Q42, sealed) unless the lab happened to
-- find the setting. The mode is now NULLABLE, with NO default: NULL means "the lab never
-- chose", and the effective mode is resolved in code (`resolveScopeEnforcementMode`,
-- packages/shared/src/scope-compliance.ts):
--
--   stored 'warn' | 'enforce'  -> that, an explicit choice, never overridden
--   NULL + accreditation toggle on  -> 'enforce'
--   NULL + accreditation toggle off -> 'warn'
--
-- so a lab that turns accreditation on later is enforced from that moment, and a lab
-- that chose `warn` explicitly keeps it. `warn` stays selectable (PUT
-- /api/accredited-scope/enforcement), is audited like before
-- (`accredited_scope_line_audit_log`, action `enforcement_mode_change`), and never seals
-- an adverse or unevaluated result (Q42 freezes the seal from the scope verdict).
--
-- Existing rows: 'warn' cannot be told apart from the old column default, except by the
-- audit trail. A lab whose 'warn' has NO `enforcement_mode_change` row never changed the
-- mode, so that 'warn' was the default and becomes NULL (-> enforce when accredited). A
-- lab with such a row chose its value (also a 'warn' it returned to) and is left alone;
-- rows already 'enforce' are untouched. The one choice this cannot see is a PUT of 'warn'
-- on a lab that was already at 'warn' (no change, so no audit row): it is treated as the
-- default. Accredited labs affected can switch back to `warn` in one request.
--
-- Idempotent: DROP NOT NULL / DROP DEFAULT are no-ops when repeated, and the UPDATE only
-- touches rows still stored as 'warn' without an audit row (a lab that switched after
-- this migration has one). SET LOCAL lock_timeout fails fast instead of queueing behind a
-- long transaction while the short ACCESS EXCLUSIVE lock is taken.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "organization" ALTER COLUMN "scope_enforcement_mode" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "organization" ALTER COLUMN "scope_enforcement_mode" DROP DEFAULT;
--> statement-breakpoint
UPDATE "organization" AS o
SET "scope_enforcement_mode" = NULL
WHERE o."scope_enforcement_mode" = 'warn'
  AND NOT EXISTS (
    SELECT 1
    FROM "accredited_scope_line_audit_log" AS a
    WHERE a."organization_id" = o."id"
      AND a."action" = 'enforcement_mode_change'
  );
