CREATE TABLE "commercial_offer_access_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"event_type" text NOT NULL,
	"public_state" text,
	"ip_address" text,
	"user_agent" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commercial_offer" ADD COLUMN "public_token_hash" text;--> statement-breakpoint
ALTER TABLE "commercial_offer" ADD COLUMN "public_token_issued_at" timestamp;--> statement-breakpoint
ALTER TABLE "commercial_offer" ADD COLUMN "public_token_revoked_at" timestamp;--> statement-breakpoint
ALTER TABLE "commercial_offer" ADD COLUMN "public_viewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "commercial_offer" ADD COLUMN "public_last_access_at" timestamp;--> statement-breakpoint
ALTER TABLE "commercial_offer" ADD COLUMN "customer_checkout_url_path" text;--> statement-breakpoint
ALTER TABLE "commercial_offer_access_log" ADD CONSTRAINT "commercial_offer_access_log_offer_id_commercial_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."commercial_offer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commercial_offer_access_log_offer_idx" ON "commercial_offer_access_log" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "commercial_offer_access_log_event_type_idx" ON "commercial_offer_access_log" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "commercial_offer_access_log_created_at_idx" ON "commercial_offer_access_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_offer_public_token_hash_uidx" ON "commercial_offer" USING btree ("public_token_hash");