-- Expiry indexes for the Better Auth session/verification tables. The
-- auth-maintenance cron (apps/api /api/cron/auth-maintenance) deletes expired
-- rows weekly; without these indexes that sweep is a sequential scan. Additive
-- and online-safe: index-only, no column changes.
CREATE INDEX IF NOT EXISTS "session_expires_at_idx" ON "session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_expires_at_idx" ON "verification" USING btree ("expires_at");
