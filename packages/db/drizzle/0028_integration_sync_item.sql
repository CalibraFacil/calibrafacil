CREATE TABLE "integration_sync_item" (
  "id" text PRIMARY KEY NOT NULL,
  "run_id" text NOT NULL,
  "integration_id" text NOT NULL,
  "organization_id" text NOT NULL,
  "target" text NOT NULL,
  "local_entity_id" text NOT NULL,
  "remote_entity_id" text,
  "operation" text NOT NULL,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "last_error_code" text,
  "last_error_message" text,
  "request_fingerprint" text,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_sync_item" ADD CONSTRAINT "integration_sync_item_run_id_integration_sync_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."integration_sync_run"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "integration_sync_item" ADD CONSTRAINT "integration_sync_item_integration_id_organization_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."organization_integration"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "integration_sync_item" ADD CONSTRAINT "integration_sync_item_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "integration_sync_item" ADD CONSTRAINT "integration_sync_item_integration_org_fk" FOREIGN KEY ("integration_id","organization_id") REFERENCES "public"."organization_integration"("id","organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "integration_sync_item_run_idx" ON "integration_sync_item" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX "integration_sync_item_integration_target_status_idx" ON "integration_sync_item" USING btree ("integration_id","target","status");
--> statement-breakpoint
CREATE INDEX "integration_sync_item_local_entity_idx" ON "integration_sync_item" USING btree ("integration_id","local_entity_id");
--> statement-breakpoint
CREATE INDEX "integration_sync_item_request_fingerprint_idx" ON "integration_sync_item" USING btree ("integration_id","target","request_fingerprint");
--> statement-breakpoint
CREATE INDEX "integration_sync_item_dead_letter_idx" ON "integration_sync_item" USING btree ("integration_id","status","updated_at");
