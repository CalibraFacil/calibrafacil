-- Phase 2 slice 9: batch / consolidated billing groups. Many service
-- orders can share one billing document via the join table.
-- Compatibility rules live in apps/api/src/lib/billing-group.ts.
-- Additive only.

CREATE TABLE "billing_group" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "customer_id" integer NOT NULL,
  "status" text DEFAULT 'OPEN' NOT NULL,
  "payment_term_days" integer DEFAULT 28 NOT NULL,
  "currency" text DEFAULT 'BRL' NOT NULL,
  "billing_period_from" timestamp,
  "billing_period_to" timestamp,
  "notes" text,
  "created_by_user_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_group" ADD CONSTRAINT "billing_group_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "billing_group" ADD CONSTRAINT "billing_group_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "billing_group" ADD CONSTRAINT "billing_group_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "billing_group_org_idx" ON "billing_group" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "billing_group_customer_idx" ON "billing_group" USING btree ("organization_id","customer_id");
--> statement-breakpoint
CREATE INDEX "billing_group_status_idx" ON "billing_group" USING btree ("organization_id","status");
--> statement-breakpoint

CREATE TABLE "billing_group_service_order" (
  "id" serial PRIMARY KEY NOT NULL,
  "group_id" integer NOT NULL,
  "service_order_id" integer NOT NULL,
  "added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_group_service_order" ADD CONSTRAINT "billing_group_service_order_group_id_billing_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."billing_group"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "billing_group_service_order" ADD CONSTRAINT "billing_group_service_order_service_order_id_service_order_id_fk" FOREIGN KEY ("service_order_id") REFERENCES "public"."service_order"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_group_service_order_uidx" ON "billing_group_service_order" USING btree ("group_id","service_order_id");
--> statement-breakpoint
CREATE INDEX "billing_group_service_order_so_idx" ON "billing_group_service_order" USING btree ("service_order_id");
