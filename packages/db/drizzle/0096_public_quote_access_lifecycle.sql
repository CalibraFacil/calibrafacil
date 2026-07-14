-- #785 Public quote approval — access code + token lifecycle (spec REQ-QPUB-*).
-- 1) service_order_public_access_token: `code_hash` (peppered HMAC-SHA-256 of
--    the human-typeable approval code; NULL on service_order-scoped grants and
--    redemption-minted sibling tokens) and `revoked_reason`
--    ('decided' | 'superseded') giving revoked_at a queryable cause so the API
--    can answer 410 "orçamento respondido" vs generic 404.
-- 2) public_code_redeem_throttle: fixed-window per-IP failed-attempt counter
--    for the public redeem-code endpoint. The IP is stored as a SHA-256 hash
--    (no raw PII at rest); no FK/organization column on purpose — the traffic
--    is pre-auth and unattributable.
-- Additive — no existing query is affected.
ALTER TABLE "service_order_public_access_token" ADD COLUMN IF NOT EXISTS "code_hash" text;--> statement-breakpoint
ALTER TABLE "service_order_public_access_token" ADD COLUMN IF NOT EXISTS "revoked_reason" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "service_order_public_access_token_code_hash_uidx" ON "service_order_public_access_token" USING btree ("code_hash");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public_code_redeem_throttle" (
	"id" serial PRIMARY KEY NOT NULL,
	"ip_hash" text NOT NULL,
	"window_starts_at" timestamp NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "public_code_redeem_throttle_ip_window_uidx" ON "public_code_redeem_throttle" USING btree ("ip_hash","window_starts_at");
