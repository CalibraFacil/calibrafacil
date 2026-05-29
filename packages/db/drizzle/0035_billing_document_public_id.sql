ALTER TABLE "billing_document" ADD COLUMN "public_id" text DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_document" ADD CONSTRAINT "billing_document_public_id_unique" UNIQUE("public_id");
