-- Service-order document numbers are unique PER LABORATORY (same bug class as 0124, decision Q33).
--
-- The tag, quote, intake and delivery document numbers are derived from the per-laboratory
-- service-order number (`OS-2026-0001-TAG-1`, `OS-2026-0001/ORC`, `/REC`, `/ENT`), but their
-- unique indexes were GLOBAL: the first order of the year of a second laboratory collided with
-- the first laboratory's, and the request failed on every retry. This migration drops the four
-- global indexes and creates unique indexes led by organization_id. The new indexes are strictly
-- weaker than the old ones, so every existing row satisfies them.
--
-- `receivable_installment_document_number_uidx` (document_id, installment_number) is left alone:
-- it is unique per billing document, which is itself a laboratory's row.
--
-- Idempotent (IF EXISTS / IF NOT EXISTS): this project applies migration DDL by hand and
-- the drizzle bookkeeping table lags behind it. SET LOCAL lock_timeout fails fast instead
-- of queueing behind a long transaction while the short ACCESS EXCLUSIVE locks are taken.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
DROP INDEX IF EXISTS "service_order_intake_document_number_version_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "service_order_intake_document_org_number_version_uidx" ON "service_order_intake_document" USING btree ("organization_id", "document_number", "version");
--> statement-breakpoint
DROP INDEX IF EXISTS "service_order_tag_number_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "service_order_tag_org_number_uidx" ON "service_order_tag" USING btree ("organization_id", "tag_number");
--> statement-breakpoint
DROP INDEX IF EXISTS "service_order_delivery_document_number_version_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "service_order_delivery_document_org_number_version_uidx" ON "service_order_delivery_document" USING btree ("organization_id", "document_number", "version");
--> statement-breakpoint
DROP INDEX IF EXISTS "service_order_quote_number_version_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "service_order_quote_org_number_version_uidx" ON "service_order_quote" USING btree ("organization_id", "quote_number", "version");
