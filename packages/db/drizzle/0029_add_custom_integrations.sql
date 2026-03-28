CREATE TABLE "organization_integration" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "type" text NOT NULL,
  "provider" text NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'ACTIVE' NOT NULL,
  "created_by" text NOT NULL REFERENCES "user"("id") ON DELETE restrict,
  "updated_by" text REFERENCES "user"("id") ON DELETE set null,
  "last_validated_at" timestamp,
  "last_validation_error" text,
  "disabled_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "organization_integration_org_id_idx"
  ON "organization_integration" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "organization_integration_status_idx"
  ON "organization_integration" USING btree ("status");
--> statement-breakpoint

CREATE TABLE "integration_connection" (
  "id" text PRIMARY KEY NOT NULL,
  "integration_id" text NOT NULL REFERENCES "organization_integration"("id") ON DELETE cascade,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "credential_type" text DEFAULT 'bearer' NOT NULL,
  "config" jsonb NOT NULL,
  "encrypted_secret" text NOT NULL,
  "secret_iv" text NOT NULL,
  "created_by" text NOT NULL REFERENCES "user"("id") ON DELETE restrict,
  "updated_by" text REFERENCES "user"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX "integration_connection_integration_uidx"
  ON "integration_connection" USING btree ("integration_id");
--> statement-breakpoint
CREATE INDEX "integration_connection_org_id_idx"
  ON "integration_connection" USING btree ("organization_id");
--> statement-breakpoint

CREATE TABLE "integration_object_link" (
  "id" text PRIMARY KEY NOT NULL,
  "integration_id" text NOT NULL REFERENCES "organization_integration"("id") ON DELETE cascade,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "target" text NOT NULL,
  "local_entity_id" text NOT NULL,
  "remote_entity_id" text,
  "remote_display_id" text,
  "last_synced_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX "integration_object_link_local_uidx"
  ON "integration_object_link" USING btree ("integration_id", "target", "local_entity_id");
--> statement-breakpoint
CREATE INDEX "integration_object_link_remote_idx"
  ON "integration_object_link" USING btree ("integration_id", "target", "remote_entity_id");
--> statement-breakpoint

CREATE TABLE "integration_sync_run" (
  "id" text PRIMARY KEY NOT NULL,
  "integration_id" text NOT NULL REFERENCES "organization_integration"("id") ON DELETE cascade,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "trigger" text NOT NULL,
  "target" text NOT NULL,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "initiated_by" text REFERENCES "user"("id") ON DELETE set null,
  "processed_count" integer DEFAULT 0 NOT NULL,
  "success_count" integer DEFAULT 0 NOT NULL,
  "error_count" integer DEFAULT 0 NOT NULL,
  "summary" jsonb,
  "error_summary" text,
  "started_at" timestamp,
  "finished_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "integration_sync_run_integration_idx"
  ON "integration_sync_run" USING btree ("integration_id");
--> statement-breakpoint
CREATE INDEX "integration_sync_run_org_idx"
  ON "integration_sync_run" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "integration_sync_run_status_idx"
  ON "integration_sync_run" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "integration_sync_run_created_at_idx"
  ON "integration_sync_run" USING btree ("created_at");
--> statement-breakpoint

CREATE TABLE "integration_event_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "integration_id" text NOT NULL REFERENCES "organization_integration"("id") ON DELETE cascade,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "run_id" text REFERENCES "integration_sync_run"("id") ON DELETE cascade,
  "level" text DEFAULT 'info' NOT NULL,
  "event" text NOT NULL,
  "message" text NOT NULL,
  "details" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "integration_event_log_integration_idx"
  ON "integration_event_log" USING btree ("integration_id");
--> statement-breakpoint
CREATE INDEX "integration_event_log_org_idx"
  ON "integration_event_log" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "integration_event_log_run_idx"
  ON "integration_event_log" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX "integration_event_log_created_at_idx"
  ON "integration_event_log" USING btree ("created_at");
