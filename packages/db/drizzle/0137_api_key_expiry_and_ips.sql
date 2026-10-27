-- API keys expire and can be bound to client addresses (roadmap 2 D3, review 3.3).
--
-- `expires_at`: after it the key no longer authenticates. New keys get one (365 days by
-- default, at most 730); keys made before this migration keep NULL (no expiry) and are
-- listed as such, so the laboratory can rotate them.
-- `allowed_ips`: client addresses or CIDR ranges (jsonb array of strings) the key is
-- accepted from; NULL or empty accepts any address.
--
-- Idempotent (IF NOT EXISTS).
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "organization_api_key" ADD COLUMN IF NOT EXISTS "expires_at" timestamp;
--> statement-breakpoint
ALTER TABLE "organization_api_key" ADD COLUMN IF NOT EXISTS "allowed_ips" jsonb;
