CREATE TABLE "notification" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipient_user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"priority" text DEFAULT 'MEDIUM' NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"related_entity" jsonb,
	"action_url" text,
	"channels_sent" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'UNREAD' NOT NULL,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"preferences" jsonb NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"digest_frequency" text DEFAULT 'NONE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preference_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "payment_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"subscription_id" integer NOT NULL,
	"organization_id" text NOT NULL,
	"asaas_payment_id" text,
	"asaas_invoice_url" text,
	"asaas_bank_slip_url" text,
	"asaas_pix_qr_code_url" text,
	"asaas_pix_payload" text,
	"amount" integer NOT NULL,
	"net_amount" integer,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"payment_method" text NOT NULL,
	"status" text NOT NULL,
	"source" text DEFAULT 'WEBHOOK' NOT NULL,
	"due_date" timestamp,
	"paid_at" timestamp,
	"card_last4" text,
	"card_brand" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_history_asaas_payment_id_unique" UNIQUE("asaas_payment_id")
);
--> statement-breakpoint
CREATE TABLE "scheduled_notification" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"scheduled_for" timestamp NOT NULL,
	"lead_time_days" integer DEFAULT 7 NOT NULL,
	"sent_at" timestamp,
	"canceled" boolean DEFAULT false NOT NULL,
	"canceled_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"asaas_subscription_id" text,
	"asaas_customer_id" text,
	"billing_cycle" text,
	"status" text DEFAULT 'TRIAL' NOT NULL,
	"trial_ends_at" timestamp,
	"current_period_start" timestamp,
	"current_period_end" timestamp,
	"next_billing_date" timestamp,
	"canceled_at" timestamp,
	"cancel_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_organization_id_unique" UNIQUE("organization_id"),
	CONSTRAINT "subscription_asaas_subscription_id_unique" UNIQUE("asaas_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_event_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp,
	"processing_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_event_log_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
ALTER TABLE "calibration_job" ADD COLUMN "label_url" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "asaas_customer_id" text;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_history" ADD CONSTRAINT "payment_history_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_history" ADD CONSTRAINT "payment_history_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_notification" ADD CONSTRAINT "scheduled_notification_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_recipient_user_id_idx" ON "notification" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "notification_organization_id_idx" ON "notification" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "notification_status_idx" ON "notification" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notification_type_idx" ON "notification" USING btree ("type");--> statement-breakpoint
CREATE INDEX "notification_created_at_idx" ON "notification" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preference_user_id_uidx" ON "notification_preference" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payment_subscription_id_idx" ON "payment_history" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "payment_org_id_idx" ON "payment_history" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "payment_status_idx" ON "payment_history" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_asaas_id_idx" ON "payment_history" USING btree ("asaas_payment_id");--> statement-breakpoint
CREATE INDEX "scheduled_notification_organization_id_idx" ON "scheduled_notification" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "scheduled_notification_scheduled_for_idx" ON "scheduled_notification" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "scheduled_notification_entity_idx" ON "scheduled_notification" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_notification_unique_idx" ON "scheduled_notification" USING btree ("organization_id","type","entity_type","entity_id","lead_time_days");--> statement-breakpoint
CREATE INDEX "subscription_org_id_idx" ON "subscription" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "subscription_status_idx" ON "subscription" USING btree ("status");--> statement-breakpoint
CREATE INDEX "subscription_asaas_sub_id_idx" ON "subscription" USING btree ("asaas_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_event_id_uidx" ON "webhook_event_log" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "webhook_event_type_idx" ON "webhook_event_log" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "webhook_created_at_idx" ON "webhook_event_log" USING btree ("created_at");