CREATE TABLE "organization_success_profile" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "account_owner_user_id" text REFERENCES "user"("id") ON DELETE set null,
  "account_owner_name" text,
  "account_owner_email" text,
  "support_contact_email" text,
  "onboarding_status" text DEFAULT 'NOT_STARTED' NOT NULL,
  "migration_status" text DEFAULT 'NOT_REQUIRED' NOT NULL,
  "go_live_target_date" timestamp,
  "go_live_actual_date" timestamp,
  "public_status_note" text,
  "internal_notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX "organization_success_profile_org_uidx"
  ON "organization_success_profile" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "organization_success_profile_onboarding_idx"
  ON "organization_success_profile" USING btree ("onboarding_status");
--> statement-breakpoint
CREATE INDEX "organization_success_profile_migration_idx"
  ON "organization_success_profile" USING btree ("migration_status");
--> statement-breakpoint

CREATE TABLE "organization_support_request" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "requested_by_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE restrict,
  "assigned_to_user_id" text REFERENCES "user"("id") ON DELETE set null,
  "category" text NOT NULL,
  "priority" text DEFAULT 'NORMAL' NOT NULL,
  "status" text DEFAULT 'OPEN' NOT NULL,
  "subject" text NOT NULL,
  "description" text NOT NULL,
  "public_response" text,
  "sla_target_at" timestamp,
  "first_response_at" timestamp,
  "resolved_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "organization_support_request_org_idx"
  ON "organization_support_request" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "organization_support_request_status_idx"
  ON "organization_support_request" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "organization_support_request_priority_idx"
  ON "organization_support_request" USING btree ("priority");
--> statement-breakpoint
CREATE INDEX "organization_support_request_created_at_idx"
  ON "organization_support_request" USING btree ("created_at");
--> statement-breakpoint

CREATE TABLE "organization_support_request_event" (
  "id" serial PRIMARY KEY NOT NULL,
  "support_request_id" integer NOT NULL REFERENCES "organization_support_request"("id") ON DELETE cascade,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "actor_user_id" text REFERENCES "user"("id") ON DELETE set null,
  "kind" text NOT NULL,
  "message" text NOT NULL,
  "public_visible" boolean DEFAULT false NOT NULL,
  "details" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "organization_support_request_event_request_idx"
  ON "organization_support_request_event" USING btree ("support_request_id");
--> statement-breakpoint
CREATE INDEX "organization_support_request_event_org_idx"
  ON "organization_support_request_event" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "organization_support_request_event_kind_idx"
  ON "organization_support_request_event" USING btree ("kind");
--> statement-breakpoint
CREATE INDEX "organization_support_request_event_created_at_idx"
  ON "organization_support_request_event" USING btree ("created_at");
