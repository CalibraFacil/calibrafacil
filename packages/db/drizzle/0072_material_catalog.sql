-- Material catalog (peças e materiais) + optional catalog reference on
-- service-order part line items. Phase 1 of the estoque/inventory epic (#580).
--
-- `material` is the provider-neutral parts registry: what the lab consumes on
-- repair/service orders. It mirrors the `service` table's tenancy shape
-- (organization + unit scoped, soft-delete via is_active). `controls_stock`
-- gates which materials ever participate in ERP stock movement — services
-- must never fake stock fields.
--
-- `material_id` on the quote/execution item tables is additive and nullable:
-- free-form part items keep working; catalog-bound items get prefills now and
-- stock decrement via the exported sale later.
--
-- Forward-only and idempotent: IF NOT EXISTS keeps it safe to re-run.
CREATE TABLE IF NOT EXISTS "material" (
	"id" serial PRIMARY KEY NOT NULL,
	"unit_id" integer NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sku" text,
	"unit" text DEFAULT 'un' NOT NULL,
	"unit_cost_cents" integer,
	"unit_price_cents" integer,
	"controls_stock" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "material" ADD CONSTRAINT "material_unit_id_organization_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "material" ADD CONSTRAINT "material_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_unit_id_idx" ON "material" ("unit_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_organization_id_idx" ON "material" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_is_active_idx" ON "material" ("is_active");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "material_org_sku_uidx" ON "material" ("organization_id","sku") WHERE "material"."sku" is not null;
--> statement-breakpoint
ALTER TABLE "service_order_quote_item" ADD COLUMN IF NOT EXISTS "material_id" integer;
--> statement-breakpoint
ALTER TABLE "service_order_execution_item" ADD COLUMN IF NOT EXISTS "material_id" integer;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_order_quote_item" ADD CONSTRAINT "service_order_quote_item_material_id_material_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_order_execution_item" ADD CONSTRAINT "service_order_execution_item_material_id_material_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_order_quote_item_material_idx" ON "service_order_quote_item" ("material_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_order_execution_item_material_idx" ON "service_order_execution_item" ("material_id");
