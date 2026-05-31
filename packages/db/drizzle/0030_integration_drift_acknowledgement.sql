-- Phase 2 slice 3: operator-acknowledged drift on integration_object_link.
--
-- Lets operators flag a drift entry as reviewed without resolving the
-- underlying remote difference. Acknowledged links drop out of the drift
-- queue until drift state changes again. Additive only.

ALTER TABLE "integration_object_link"
  ADD COLUMN "drift_acknowledged_at" timestamp;
--> statement-breakpoint
ALTER TABLE "integration_object_link"
  ADD COLUMN "drift_acknowledged_by_user_id" text;
--> statement-breakpoint
ALTER TABLE "integration_object_link"
  ADD COLUMN "drift_acknowledged_reason" text;
--> statement-breakpoint

ALTER TABLE "integration_object_link"
  ADD CONSTRAINT "integration_object_link_drift_ack_user_fk"
  FOREIGN KEY ("drift_acknowledged_by_user_id")
  REFERENCES "public"."user"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "integration_object_link_drift_ack_idx"
  ON "integration_object_link"
  USING btree ("organization_id", "drift_acknowledged_at");
