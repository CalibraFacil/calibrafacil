-- Phase 2 slice 6: outsourced cost capture per service order so margin
-- per job becomes visible. expected_cost_cents is operator-entered;
-- actual_cost_cents + payable_link_id are reconciled by the Conta Azul
-- payable poll. Additive only.

CREATE TABLE "service_order_outsourced_cost" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "service_order_id" integer NOT NULL,
  "supplier_name" text NOT NULL,
  "expected_cost_cents" integer NOT NULL,
  "actual_cost_cents" integer,
  "currency" text DEFAULT 'BRL' NOT NULL,
  "payable_link_id" text,
  "notes" text,
  "created_by_user_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "voided_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "service_order_outsourced_cost" ADD CONSTRAINT "service_order_outsourced_cost_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_order_outsourced_cost" ADD CONSTRAINT "service_order_outsourced_cost_service_order_id_service_order_id_fk" FOREIGN KEY ("service_order_id") REFERENCES "public"."service_order"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_order_outsourced_cost" ADD CONSTRAINT "service_order_outsourced_cost_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "service_order_outsourced_cost_org_idx" ON "service_order_outsourced_cost" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "service_order_outsourced_cost_so_idx" ON "service_order_outsourced_cost" USING btree ("service_order_id");
--> statement-breakpoint
CREATE INDEX "service_order_outsourced_cost_payable_idx" ON "service_order_outsourced_cost" USING btree ("payable_link_id");
