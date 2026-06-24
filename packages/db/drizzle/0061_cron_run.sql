-- Heartbeat + lease-lock table for the Vercel cron dispatcher. Each /api/cron/*
-- run records its outcome here (so a silently-failing or never-firing cron is
-- detectable from the DB, not just ephemeral Vercel logs) and takes a short
-- row-lease to prevent overlapping runs. A row-lease (not pg_advisory_lock) is
-- used deliberately: Neon's pooled endpoint is PgBouncer transaction-mode, where
-- session-scoped advisory locks are unreliable. The dispatcher treats this table
-- as best-effort / fail-open: if it is missing (migration not yet applied) the
-- cron still runs without a lease or heartbeat.
CREATE TABLE "cron_run" (
	"job" text PRIMARY KEY NOT NULL,
	"locked_until" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_status" text,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL
);
