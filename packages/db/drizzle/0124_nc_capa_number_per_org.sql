-- NC and CAPA numbers are unique PER LABORATORY (decision Q33).
--
-- The numbers are generated per organization (NC-<year>-0001, CAPA-<year>-0001 from the
-- organization's own last number), but `non_conformance.nc_number` and
-- `corrective_action.capa_number` carried GLOBAL unique constraints and unique indexes:
-- the first NC (or CAPA) of the year of a second laboratory collided with the first
-- laboratory's, every retry regenerated the same number, and the request failed. This
-- migration drops the four global uniques (the column constraints of migration 0000 and
-- the `nc_number_uidx` / `capa_number_uidx` indexes) and creates unique indexes on
-- (organization_id, number). The new indexes are strictly weaker than the old ones, so
-- every existing row satisfies them.
--
-- Idempotent (IF EXISTS / IF NOT EXISTS): this project applies migration DDL by hand and
-- the drizzle bookkeeping table lags behind it. SET LOCAL lock_timeout fails fast instead
-- of queueing behind a long transaction while the short ACCESS EXCLUSIVE locks are taken.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "non_conformance" DROP CONSTRAINT IF EXISTS "non_conformance_nc_number_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "nc_number_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "nc_org_number_uidx" ON "non_conformance" USING btree ("organization_id", "nc_number");
--> statement-breakpoint
ALTER TABLE "corrective_action" DROP CONSTRAINT IF EXISTS "corrective_action_capa_number_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "capa_number_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "capa_org_number_uidx" ON "corrective_action" USING btree ("organization_id", "capa_number");
