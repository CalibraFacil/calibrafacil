-- Backoffice-managed tenant lifecycle: suspend / offboard an organization from
-- the operations console instead of editing the database. `status` gates lab
-- access in `requireOrganization`; `deletion_scheduled_at` records an offboarding
-- grace window. Additive only — existing rows default to ACTIVE.

ALTER TABLE "organization" ADD COLUMN "status" text DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "suspended_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "suspension_reason" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "deletion_scheduled_at" timestamp;
