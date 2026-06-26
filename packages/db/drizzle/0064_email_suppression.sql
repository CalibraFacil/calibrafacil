-- Email unsubscribe / suppression list (issue #577).
--
-- email_suppression: durable record of addresses that must not be emailed at a
-- given scope ('marketing' | 'all'). Driven by Resend complaint/hard-bounce
-- webhooks plus manual/API opt-outs. Email is stored lowercased/trimmed; the
-- UNIQUE (email, scope) index makes the suppress upsert idempotent.
--
-- email_webhook_event: minimal dedup ledger for inbound Resend (Svix-signed)
-- webhook deliveries. Delivery is at-least-once, so the unique svix_id lets a
-- redelivery be recognized and skipped before the side effect is re-applied.
--
-- Both tables are additive and safe to (re-)apply on a fresh or current schema.
CREATE TABLE "email_suppression" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"scope" text DEFAULT 'all' NOT NULL,
	"reason" text NOT NULL,
	"source" text NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_webhook_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"svix_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_webhook_event_svix_id_unique" UNIQUE("svix_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "email_suppression_email_scope_uidx" ON "email_suppression" USING btree ("email","scope");--> statement-breakpoint
CREATE INDEX "email_suppression_email_idx" ON "email_suppression" USING btree ("email");
