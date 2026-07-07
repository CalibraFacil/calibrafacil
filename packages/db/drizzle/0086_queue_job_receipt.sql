-- idempotency ledger for queue consumers.
-- One receipt per delivery unit (app_queue_job row / Vercel Queue message);
-- a COMPLETED receipt lets a duplicate delivery skip re-running the work.
CREATE TABLE "queue_job_receipt" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"locked_until" timestamp NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "queue_job_receipt_type_key_unique" ON "queue_job_receipt" ("job_type","idempotency_key");--> statement-breakpoint
CREATE INDEX "queue_job_receipt_completed_at_idx" ON "queue_job_receipt" ("completed_at");
