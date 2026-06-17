-- Freeze blueprint-driven instrument specs on the service-order asset snapshot.
-- `display_specs` stores an ordered [{label, value}] list captured at intake, so the
-- printed service order can render any asset type's specs generically (a manômetro's
-- pressure range, a balança's capacity/resolution, etc.) instead of hardcoded weighing
-- rows. Additive + nullable; pre-existing snapshots stay NULL and the document renderer
-- falls back to the live asset-type blueprint for those.
-- (IF NOT EXISTS keeps this safe to re-run on the drizzle meta in its current state.)
ALTER TABLE "service_order_asset_snapshot" ADD COLUMN IF NOT EXISTS "display_specs" jsonb;
