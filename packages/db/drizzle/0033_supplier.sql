-- Phase 2 slice 7: normalized supplier records (outsourced labs +
-- transporters). Lets slice 6's outsourced-cost row reference a
-- supplier by id instead of free text, and lets Conta Azul person
-- links match against suppliers via the existing object-link flow.
-- Additive only.

CREATE TABLE "supplier" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "name" text NOT NULL,
  "tax_id" text,
  "email" text,
  "phone" text,
  "kind" text DEFAULT 'other' NOT NULL,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "archived_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "supplier_org_idx" ON "supplier" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "supplier_org_name_idx" ON "supplier" USING btree ("organization_id","name");
