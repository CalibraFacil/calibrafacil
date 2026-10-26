-- Public-API webhook deliveries go through the database queue (roadmap 2 A8).
--
-- A delivery used to be one synchronous attempt inside the request that caused the event,
-- storing whatever the subscriber answered. It is now a queue job (WEBHOOK_DELIVERY) the
-- worker retries with exponential backoff, so the delivery row records every attempt and
-- when the next one is due, and a subscription that keeps failing switches itself off with
-- the reason recorded. The subscriber's answer is kept as a short snippet only: the
-- subscriber is outside our control (the old column could hold, and the deliveries
-- endpoint return, an internal service's whole response).
--
-- Idempotent (IF NOT EXISTS): this project applies migration DDL by hand and the drizzle
-- bookkeeping table lags behind it. app_queue_job.type has no CHECK constraint, so the new
-- job type needs no DDL.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "public_api_webhook_subscription" ADD COLUMN IF NOT EXISTS "disabled_at" timestamp;
--> statement-breakpoint
ALTER TABLE "public_api_webhook_subscription" ADD COLUMN IF NOT EXISTS "disabled_reason" text;
--> statement-breakpoint
ALTER TABLE "public_api_webhook_delivery" ADD COLUMN IF NOT EXISTS "attempts" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "public_api_webhook_delivery" ADD COLUMN IF NOT EXISTS "next_attempt_at" timestamp;
--> statement-breakpoint
-- Answers stored before this change may hold a whole response body: cut them to the snippet length.
UPDATE "public_api_webhook_delivery"
SET "response_body" = left("response_body", 512)
WHERE "response_body" IS NOT NULL AND length("response_body") > 512;
