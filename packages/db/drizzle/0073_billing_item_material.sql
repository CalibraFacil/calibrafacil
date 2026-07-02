-- Phase 2 of the estoque/inventory epic (#580): billing lines remember which
-- catalog material they bill. `material_id` is copied from the approved
-- quote's part line items when the OS generates its billing document; the
-- ERP export resolves it to the linked product so the sale (Venda) carries a
-- real product line and Conta Azul decrements stock on billing.
--
-- Additive and nullable: existing billing documents and non-part lines keep
-- material_id null. Forward-only and idempotent.
ALTER TABLE "billing_document_item" ADD COLUMN IF NOT EXISTS "material_id" integer;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_document_item" ADD CONSTRAINT "billing_document_item_material_id_material_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_document_item_material_idx" ON "billing_document_item" ("material_id");
