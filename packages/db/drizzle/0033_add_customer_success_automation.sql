ALTER TABLE "organization_success_profile"
  ADD COLUMN "blockers" jsonb,
  ADD COLUMN "next_action_completed_at" timestamp;
--> statement-breakpoint

ALTER TABLE "organization_support_request"
  ADD COLUMN "escalated_at" timestamp,
  ADD COLUMN "escalated_by_user_id" text REFERENCES "user"("id") ON DELETE set null,
  ADD COLUMN "escalation_reason" text;
--> statement-breakpoint

CREATE INDEX "organization_success_profile_next_action_due_idx"
  ON "organization_success_profile" USING btree ("next_action_due_at");
--> statement-breakpoint

CREATE INDEX "organization_support_request_escalated_at_idx"
  ON "organization_support_request" USING btree ("escalated_at");
