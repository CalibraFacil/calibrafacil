ALTER TABLE "organization_success_profile"
  ADD COLUMN "internal_owner_user_id" text REFERENCES "user"("id") ON DELETE set null,
  ADD COLUMN "priority_support" boolean DEFAULT false NOT NULL,
  ADD COLUMN "sla_tier" text DEFAULT 'PLAN_DEFAULT' NOT NULL,
  ADD COLUMN "go_live_status" text DEFAULT 'NOT_SCHEDULED' NOT NULL,
  ADD COLUMN "health_status" text DEFAULT 'HEALTHY' NOT NULL,
  ADD COLUMN "next_action" text,
  ADD COLUMN "next_action_due_at" timestamp,
  ADD COLUMN "last_touched_at" timestamp;
--> statement-breakpoint

UPDATE "organization_success_profile"
SET
  "go_live_status" = CASE
    WHEN "go_live_actual_date" IS NOT NULL THEN 'LIVE'
    WHEN "go_live_target_date" IS NOT NULL THEN 'SCHEDULED'
    ELSE 'NOT_SCHEDULED'
  END,
  "last_touched_at" = COALESCE("updated_at", "created_at");
--> statement-breakpoint

CREATE INDEX "organization_success_profile_go_live_idx"
  ON "organization_success_profile" USING btree ("go_live_status");
--> statement-breakpoint
CREATE INDEX "organization_success_profile_health_idx"
  ON "organization_success_profile" USING btree ("health_status");
--> statement-breakpoint
CREATE INDEX "organization_success_profile_priority_support_idx"
  ON "organization_success_profile" USING btree ("priority_support");
