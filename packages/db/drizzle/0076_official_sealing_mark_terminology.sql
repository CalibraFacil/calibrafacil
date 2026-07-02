-- Official Inmetro terminology (marca de selagem / marca de reparo).
-- Rename the seal columns to match the normative vocabulary now used across
-- the product: "marca de selagem retirada/aposta" (removed/affixed sealing
-- mark) and "Marca de Reparo" (repair mark). Data is preserved (RENAME).
-- Also drops the long-deprecated orphaned `repaired_seal_number` column
-- (no input UI, never rendered) and migrates the stored event-log type.
ALTER TABLE "service_order" RENAME COLUMN "old_seal_number" TO "removed_sealing_mark_number";--> statement-breakpoint
ALTER TABLE "service_order" RENAME COLUMN "new_seal_number" TO "affixed_sealing_mark_number";--> statement-breakpoint
ALTER TABLE "service_order" RENAME COLUMN "inmetro_repair_seal_number" TO "inmetro_repair_mark_number";--> statement-breakpoint
ALTER TABLE "service_order" RENAME COLUMN "inmetro_repair_seal_issued_at" TO "inmetro_repair_mark_issued_at";--> statement-breakpoint
ALTER TABLE "service_order" RENAME COLUMN "inmetro_repair_seal_applied_at" TO "inmetro_repair_mark_applied_at";--> statement-breakpoint
ALTER TABLE "service_order" RENAME COLUMN "inmetro_repair_seal_applied_by_user_id" TO "inmetro_repair_mark_applied_by_user_id";--> statement-breakpoint
ALTER TABLE "service_order" RENAME COLUMN "inmetro_repair_seal_notes" TO "inmetro_repair_mark_notes";--> statement-breakpoint
ALTER TABLE "service_order" DROP COLUMN IF EXISTS "repaired_seal_number";--> statement-breakpoint
UPDATE "service_order_event_log" SET "event_type" = 'service_order.repair_mark_updated' WHERE "event_type" = 'service_order.repair_seal_updated';
