CREATE TABLE "public_api_resource_ref" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text NOT NULL,
  "external_id" text NOT NULL,
  "created_by_api_key_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_api_idempotency_key" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "api_key_id" text NOT NULL,
  "request_method" text NOT NULL,
  "request_path" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "response_status" integer NOT NULL,
  "response_body" jsonb NOT NULL,
  "resource_type" text,
  "resource_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "public_api_webhook_subscription" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "name" text NOT NULL,
  "target_url" text NOT NULL,
  "events" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'ACTIVE' NOT NULL,
  "secret_prefix" text NOT NULL,
  "encrypted_secret" text NOT NULL,
  "secret_iv" text NOT NULL,
  "last_success_at" timestamp,
  "last_failure_at" timestamp,
  "consecutive_failures" integer DEFAULT 0 NOT NULL,
  "created_by" text NOT NULL,
  "updated_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_api_webhook_delivery" (
  "id" text PRIMARY KEY NOT NULL,
  "subscription_id" text NOT NULL,
  "organization_id" text NOT NULL,
  "event_id" text NOT NULL,
  "event_type" text NOT NULL,
  "request_url" text NOT NULL,
  "request_body" jsonb NOT NULL,
  "response_status" integer,
  "response_body" text,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "delivered_at" timestamp,
  "failed_at" timestamp,
  "last_error" text,
  "replay_of_delivery_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "public_api_resource_ref"
  ADD CONSTRAINT "public_api_resource_ref_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "public_api_resource_ref"
  ADD CONSTRAINT "public_api_resource_ref_created_by_api_key_id_fk"
  FOREIGN KEY ("created_by_api_key_id") REFERENCES "organization_api_key"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "public_api_idempotency_key"
  ADD CONSTRAINT "public_api_idempotency_key_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "public_api_idempotency_key"
  ADD CONSTRAINT "public_api_idempotency_key_api_key_id_fk"
  FOREIGN KEY ("api_key_id") REFERENCES "organization_api_key"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "public_api_webhook_subscription"
  ADD CONSTRAINT "public_api_webhook_subscription_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "public_api_webhook_subscription"
  ADD CONSTRAINT "public_api_webhook_subscription_created_by_fk"
  FOREIGN KEY ("created_by") REFERENCES "user"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "public_api_webhook_subscription"
  ADD CONSTRAINT "public_api_webhook_subscription_updated_by_fk"
  FOREIGN KEY ("updated_by") REFERENCES "user"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "public_api_webhook_delivery"
  ADD CONSTRAINT "public_api_webhook_delivery_subscription_id_fk"
  FOREIGN KEY ("subscription_id") REFERENCES "public_api_webhook_subscription"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "public_api_webhook_delivery"
  ADD CONSTRAINT "public_api_webhook_delivery_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "public_api_resource_ref_org_idx"
  ON "public_api_resource_ref" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "public_api_resource_ref_type_idx"
  ON "public_api_resource_ref" USING btree ("resource_type");
--> statement-breakpoint
CREATE UNIQUE INDEX "public_api_resource_ref_external_uidx"
  ON "public_api_resource_ref" USING btree ("organization_id","resource_type","external_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "public_api_resource_ref_resource_uidx"
  ON "public_api_resource_ref" USING btree ("organization_id","resource_type","resource_id");
--> statement-breakpoint
CREATE INDEX "public_api_idempotency_org_idx"
  ON "public_api_idempotency_key" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "public_api_idempotency_api_key_idx"
  ON "public_api_idempotency_key" USING btree ("api_key_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "public_api_idempotency_request_uidx"
  ON "public_api_idempotency_key" USING btree ("organization_id","api_key_id","request_method","request_path","idempotency_key");
--> statement-breakpoint
CREATE INDEX "public_api_webhook_subscription_org_idx"
  ON "public_api_webhook_subscription" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "public_api_webhook_subscription_status_idx"
  ON "public_api_webhook_subscription" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "public_api_webhook_delivery_subscription_idx"
  ON "public_api_webhook_delivery" USING btree ("subscription_id");
--> statement-breakpoint
CREATE INDEX "public_api_webhook_delivery_org_idx"
  ON "public_api_webhook_delivery" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "public_api_webhook_delivery_event_idx"
  ON "public_api_webhook_delivery" USING btree ("event_id");
--> statement-breakpoint
CREATE INDEX "public_api_webhook_delivery_status_idx"
  ON "public_api_webhook_delivery" USING btree ("status");
