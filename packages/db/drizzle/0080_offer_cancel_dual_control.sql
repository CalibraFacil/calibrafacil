-- DOM-04 (#657): bind dual-control (approval_request) to the real financial
-- action. Adds the downstream link the maker-checker queue was missing: the
-- APPROVED `approval_request` that authorized a money-touching cancel of a
-- commercial offer. The backoffice cancel path now refuses to execute without a
-- linked, APPROVED, org-matching, distinct-identity approval and persists this
-- column as the audit link.
--
-- Additive and nullable: existing/non-canceled offers keep approval_request_id
-- null. ON DELETE SET NULL so purging an approval_request never erases the
-- offer's cancel record. Forward-only and idempotent.
ALTER TABLE "commercial_offer" ADD COLUMN IF NOT EXISTS "approval_request_id" integer;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "commercial_offer" ADD CONSTRAINT "commercial_offer_approval_request_id_approval_request_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_request"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commercial_offer_approval_request_idx" ON "commercial_offer" USING btree ("approval_request_id");
