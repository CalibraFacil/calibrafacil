ALTER TABLE "user"
  ADD COLUMN "role" text DEFAULT 'user' NOT NULL,
  ADD COLUMN "banned" boolean DEFAULT false NOT NULL,
  ADD COLUMN "ban_reason" text,
  ADD COLUMN "ban_expires" timestamp;
--> statement-breakpoint

ALTER TABLE "session"
  ADD COLUMN "impersonated_by" text REFERENCES "user"("id") ON DELETE set null;
--> statement-breakpoint

CREATE TABLE "platform_event_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "actor_user_id" text REFERENCES "user"("id") ON DELETE set null,
  "target_user_id" text REFERENCES "user"("id") ON DELETE set null,
  "action" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text,
  "details" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "platform_event_log_action_idx"
  ON "platform_event_log" USING btree ("action");
--> statement-breakpoint
CREATE INDEX "platform_event_log_actor_user_idx"
  ON "platform_event_log" USING btree ("actor_user_id");
--> statement-breakpoint
CREATE INDEX "platform_event_log_target_user_idx"
  ON "platform_event_log" USING btree ("target_user_id");
--> statement-breakpoint
CREATE INDEX "platform_event_log_created_at_idx"
  ON "platform_event_log" USING btree ("created_at");
