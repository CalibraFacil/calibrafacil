-- SEC-03b (#638): make asset.tag unique PER LAB ORG instead of globally.
--
-- Before this migration `asset.tag` had TWO global unique artifacts (both from
-- migration 0000): the `asset_tag_unique` constraint and the `asset_tag_uidx`
-- index. A global unique means two different labs cannot reuse a tag, and the
-- collision check leaked a cross-tenant existence oracle (409-vs-201). Part (a)
-- (PR #690) scoped the app-level checks by org; this half denormalizes the lab
-- org onto `asset` and replaces the global uniques with a composite
-- UNIQUE(lab_organization_id, tag), so a cross-org duplicate tag is a clean
-- insert.
--
-- Forward-only. Ordered CREATE-before-DROP so tag uniqueness is never
-- unprotected: the per-org unique exists before the global ones are removed.
-- The backfill is total because `asset.customer_id` is NOT NULL (every asset has
-- a customer) and `customer.lab_organization_id` is NOT NULL, so no asset is
-- left with a NULL org before SET NOT NULL. The composite UNIQUE is trivially
-- satisfied by existing rows: the pre-existing global unique guarantees zero
-- duplicate tags, so no (lab_organization_id, tag) pair can collide.

-- (a) Add the column nullable so existing rows are accepted.
ALTER TABLE "asset" ADD COLUMN IF NOT EXISTS "lab_organization_id" text;--> statement-breakpoint

-- (b) Backfill from the owning customer (invariant: asset.lab_org == customer.lab_org).
UPDATE "asset"
SET "lab_organization_id" = "customer"."lab_organization_id"
FROM "customer"
WHERE "asset"."customer_id" = "customer"."id"
  AND "asset"."lab_organization_id" IS NULL;--> statement-breakpoint

-- (c) Enforce NOT NULL (safe: customer_id is NOT NULL → the backfill covered every row).
ALTER TABLE "asset" ALTER COLUMN "lab_organization_id" SET NOT NULL;--> statement-breakpoint

-- (d) Foreign key to organization (mirrors customer.lab_organization_id: ON DELETE cascade).
DO $$ BEGIN
 ALTER TABLE "asset" ADD CONSTRAINT "asset_lab_organization_id_organization_id_fk" FOREIGN KEY ("lab_organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- (d) Per-org composite unique — created BEFORE dropping the global uniques so
-- there is never a window without tag protection.
CREATE UNIQUE INDEX IF NOT EXISTS "asset_lab_org_tag_uidx" ON "asset" USING btree ("lab_organization_id","tag");--> statement-breakpoint

-- (e) Drop both global uniques on tag (constraint + index, both from 0000).
ALTER TABLE "asset" DROP CONSTRAINT IF EXISTS "asset_tag_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "asset_tag_uidx";
