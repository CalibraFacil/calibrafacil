DROP TABLE IF EXISTS "payment_status_history" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "payment_record" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "commercial_offer_status_history" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "commercial_offer_item" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "subscription" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "commercial_offer" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "commercial_deal" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "billing_contact" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "billing_customer" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "provider_webhook_event" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "payment_history" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "webhook_event_log" CASCADE;
--> statement-breakpoint
CREATE TABLE "billing_contact" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"role" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_customer" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text DEFAULT 'ASAAS' NOT NULL,
	"provider_customer_id" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"tax_id" text,
	"address_snapshot" jsonb,
	"provider_snapshot" jsonb,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_customer_provider_customer_id_unique" UNIQUE("provider_customer_id")
);
--> statement-breakpoint
CREATE TABLE "commercial_deal" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"primary_billing_contact_id" integer,
	"created_by" text,
	"closed_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commercial_offer" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"provider" text DEFAULT 'ASAAS' NOT NULL,
	"provider_mode" text NOT NULL,
	"activation_behavior" text DEFAULT 'NONE' NOT NULL,
	"base_plan_id" text,
	"billing_cycle" text,
	"contract_term_months" integer,
	"renewal_mode" text DEFAULT 'NONE' NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"subtotal_amount" integer NOT NULL,
	"discount_amount" integer DEFAULT 0 NOT NULL,
	"total_amount" integer NOT NULL,
	"due_date" timestamp,
	"offer_expires_at" timestamp,
	"payment_methods" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"customer_visible_description" text,
	"internal_notes" text,
	"terms_snapshot" jsonb NOT NULL,
	"customer_snapshot" jsonb NOT NULL,
	"provider_request_snapshot" jsonb,
	"provider_response_snapshot" jsonb,
	"checkout_url" text,
	"provider_checkout_id" text,
	"provider_payment_id" text,
	"provider_subscription_id" text,
	"billing_customer_id" integer NOT NULL,
	"issued_at" timestamp,
	"paid_at" timestamp,
	"activated_at" timestamp,
	"canceled_at" timestamp,
	"created_by" text,
	"canceled_by" text,
	"reissued_from_offer_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commercial_offer_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"type" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_amount" integer NOT NULL,
	"total_amount" integer NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commercial_offer_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"source" text NOT NULL,
	"source_event_id" text,
	"payload" jsonb,
	"changed_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_record" (
	"id" serial PRIMARY KEY NOT NULL,
	"commercial_offer_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text DEFAULT 'ASAAS' NOT NULL,
	"provider_checkout_id" text,
	"provider_payment_id" text,
	"provider_subscription_id" text,
	"external_reference" text,
	"amount" integer NOT NULL,
	"net_amount" integer,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"payment_method" text NOT NULL,
	"status" text NOT NULL,
	"card_last4" text,
	"card_brand" text,
	"due_date" timestamp,
	"paid_at" timestamp,
	"invoice_url" text,
	"bank_slip_url" text,
	"pix_qr_code_url" text,
	"pix_payload" text,
	"provider_snapshot" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_record_id" integer NOT NULL,
	"commercial_offer_id" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"source_event_id" text,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_webhook_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'ASAAS' NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp,
	"processing_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "provider_webhook_event_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" text DEFAULT 'TRIAL' NOT NULL,
	"billing_cycle" text,
	"renewal_mode" text DEFAULT 'NONE' NOT NULL,
	"contract_term_months" integer,
	"source_commercial_offer_id" text,
	"provider_subscription_id" text,
	"current_period_start" timestamp,
	"current_period_end" timestamp,
	"next_billing_date" timestamp,
	"canceled_at" timestamp,
	"cancel_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_organization_id_unique" UNIQUE("organization_id"),
	CONSTRAINT "subscription_provider_subscription_id_unique" UNIQUE("provider_subscription_id")
);
--> statement-breakpoint
ALTER TABLE "billing_contact" ADD CONSTRAINT "billing_contact_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "billing_contact" ADD CONSTRAINT "billing_contact_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "billing_customer" ADD CONSTRAINT "billing_customer_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "billing_customer" ADD CONSTRAINT "billing_customer_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commercial_deal" ADD CONSTRAINT "commercial_deal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commercial_deal" ADD CONSTRAINT "commercial_deal_primary_billing_contact_id_billing_contact_id_fk" FOREIGN KEY ("primary_billing_contact_id") REFERENCES "public"."billing_contact"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commercial_deal" ADD CONSTRAINT "commercial_deal_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commercial_deal" ADD CONSTRAINT "commercial_deal_closed_by_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commercial_offer" ADD CONSTRAINT "commercial_offer_deal_id_commercial_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."commercial_deal"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commercial_offer" ADD CONSTRAINT "commercial_offer_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commercial_offer" ADD CONSTRAINT "commercial_offer_billing_customer_id_billing_customer_id_fk" FOREIGN KEY ("billing_customer_id") REFERENCES "public"."billing_customer"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commercial_offer" ADD CONSTRAINT "commercial_offer_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commercial_offer" ADD CONSTRAINT "commercial_offer_canceled_by_user_id_fk" FOREIGN KEY ("canceled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commercial_offer_item" ADD CONSTRAINT "commercial_offer_item_offer_id_commercial_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."commercial_offer"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commercial_offer_status_history" ADD CONSTRAINT "commercial_offer_status_history_offer_id_commercial_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."commercial_offer"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commercial_offer_status_history" ADD CONSTRAINT "commercial_offer_status_history_changed_by_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_record" ADD CONSTRAINT "payment_record_commercial_offer_id_commercial_offer_id_fk" FOREIGN KEY ("commercial_offer_id") REFERENCES "public"."commercial_offer"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_record" ADD CONSTRAINT "payment_record_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_status_history" ADD CONSTRAINT "payment_status_history_payment_record_id_payment_record_id_fk" FOREIGN KEY ("payment_record_id") REFERENCES "public"."payment_record"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_status_history" ADD CONSTRAINT "payment_status_history_commercial_offer_id_commercial_offer_id_fk" FOREIGN KEY ("commercial_offer_id") REFERENCES "public"."commercial_offer"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_source_commercial_offer_id_commercial_offer_id_fk" FOREIGN KEY ("source_commercial_offer_id") REFERENCES "public"."commercial_offer"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "billing_contact_org_idx" ON "billing_contact" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "billing_contact_primary_idx" ON "billing_contact" USING btree ("organization_id","is_primary");
--> statement-breakpoint
CREATE INDEX "billing_customer_org_idx" ON "billing_customer" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "billing_customer_status_idx" ON "billing_customer" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "commercial_deal_org_idx" ON "commercial_deal" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "commercial_deal_status_idx" ON "commercial_deal" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "commercial_offer_org_idx" ON "commercial_offer" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "commercial_offer_deal_idx" ON "commercial_offer" USING btree ("deal_id");
--> statement-breakpoint
CREATE INDEX "commercial_offer_status_idx" ON "commercial_offer" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "commercial_offer_kind_idx" ON "commercial_offer" USING btree ("kind");
--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_offer_provider_checkout_uidx" ON "commercial_offer" USING btree ("provider_checkout_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_offer_provider_payment_uidx" ON "commercial_offer" USING btree ("provider_payment_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_offer_provider_subscription_uidx" ON "commercial_offer" USING btree ("provider_subscription_id");
--> statement-breakpoint
CREATE INDEX "commercial_offer_item_offer_idx" ON "commercial_offer_item" USING btree ("offer_id");
--> statement-breakpoint
CREATE INDEX "commercial_offer_history_offer_idx" ON "commercial_offer_status_history" USING btree ("offer_id");
--> statement-breakpoint
CREATE INDEX "commercial_offer_history_source_event_idx" ON "commercial_offer_status_history" USING btree ("source_event_id");
--> statement-breakpoint
CREATE INDEX "payment_record_offer_idx" ON "payment_record" USING btree ("commercial_offer_id");
--> statement-breakpoint
CREATE INDEX "payment_record_org_idx" ON "payment_record" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "payment_record_status_idx" ON "payment_record" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_record_provider_payment_uidx" ON "payment_record" USING btree ("provider_payment_id");
--> statement-breakpoint
CREATE INDEX "payment_status_history_payment_idx" ON "payment_status_history" USING btree ("payment_record_id");
--> statement-breakpoint
CREATE INDEX "payment_status_history_offer_idx" ON "payment_status_history" USING btree ("commercial_offer_id");
--> statement-breakpoint
CREATE INDEX "provider_webhook_event_type_idx" ON "provider_webhook_event" USING btree ("event_type");
--> statement-breakpoint
CREATE INDEX "provider_webhook_event_created_idx" ON "provider_webhook_event" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "subscription_org_id_idx" ON "subscription" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "subscription_status_idx" ON "subscription" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "subscription_provider_sub_id_idx" ON "subscription" USING btree ("provider_subscription_id");
