-- Phase 3 of the estoque/inventory epic (#580): read-mostly snapshot of the
-- ERP on-hand balance per material. Stock truth stays in the ERP (saída via
-- the exported sale, entrada/ajuste via explicit product-quantity updates);
-- this mirror powers the materials list and the SO picker badges without a
-- remote round-trip. Populated by the productStock poll and by the manual
-- stock-adjust action.
--
-- Additive and nullable. Forward-only and idempotent.
ALTER TABLE "material" ADD COLUMN IF NOT EXISTS "stock_quantity" real;
--> statement-breakpoint
ALTER TABLE "material" ADD COLUMN IF NOT EXISTS "stock_synced_at" timestamp;
