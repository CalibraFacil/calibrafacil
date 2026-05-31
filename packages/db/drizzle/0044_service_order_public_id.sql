-- Opaque, non-sequential public identifier for service orders so client-facing
-- URLs don't expose the enumerable serial id. Backfills existing rows with a
-- uuid, then enforces NOT NULL + UNIQUE. Mirrors calibrationJob.verificationToken
-- and billingDocument.publicId. Additive — no existing query is affected.
ALTER TABLE "service_order" ADD COLUMN IF NOT EXISTS "public_id" text;--> statement-breakpoint
UPDATE "service_order" SET "public_id" = gen_random_uuid()::text WHERE "public_id" IS NULL;--> statement-breakpoint
ALTER TABLE "service_order" ALTER COLUMN "public_id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "service_order" ALTER COLUMN "public_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "service_order_public_id_unique" ON "service_order" ("public_id");
