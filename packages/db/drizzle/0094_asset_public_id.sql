-- Opaque, non-sequential public identifier for assets so the portal's
-- client-facing URLs (/assets/:id) don't expose the enumerable serial id.
-- Backfills existing rows with a uuid, then enforces NOT NULL + UNIQUE.
-- Mirrors serviceOrder.publicId / billingDocument.publicId. Additive — no
-- existing query is affected.
ALTER TABLE "asset" ADD COLUMN IF NOT EXISTS "public_id" text;--> statement-breakpoint
UPDATE "asset" SET "public_id" = gen_random_uuid()::text WHERE "public_id" IS NULL;--> statement-breakpoint
ALTER TABLE "asset" ALTER COLUMN "public_id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "asset" ALTER COLUMN "public_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_public_id_unique" ON "asset" ("public_id");
