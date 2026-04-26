ALTER TABLE "service_order"
ADD COLUMN "inmetro_repair_seal_issued_at" timestamp,
ADD COLUMN "inmetro_repair_seal_applied_at" timestamp,
ADD COLUMN "inmetro_repair_seal_applied_by_user_id" text,
ADD COLUMN "inmetro_repair_seal_notes" text;

ALTER TABLE "service_order"
ADD CONSTRAINT "service_order_inmetro_repair_seal_applied_by_user_id_user_id_fk"
FOREIGN KEY ("inmetro_repair_seal_applied_by_user_id")
REFERENCES "public"."user"("id")
ON DELETE set null
ON UPDATE no action;

CREATE TABLE "service_order_delivery_document" (
  "id" serial PRIMARY KEY NOT NULL,
  "service_order_id" integer NOT NULL,
  "document_number" text NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "pdf_r2_key" text,
  "issued_at" timestamp,
  "issued_by_user_id" text,
  "technician_signature_data" jsonb,
  "client_signature_data" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "service_order_delivery_document"
ADD CONSTRAINT "service_order_delivery_document_service_order_id_service_order_id_fk"
FOREIGN KEY ("service_order_id")
REFERENCES "public"."service_order"("id")
ON DELETE cascade
ON UPDATE no action;

ALTER TABLE "service_order_delivery_document"
ADD CONSTRAINT "service_order_delivery_document_issued_by_user_id_user_id_fk"
FOREIGN KEY ("issued_by_user_id")
REFERENCES "public"."user"("id")
ON DELETE set null
ON UPDATE no action;

CREATE INDEX "service_order_delivery_document_order_idx"
ON "service_order_delivery_document" USING btree ("service_order_id");

CREATE UNIQUE INDEX "service_order_delivery_document_number_version_uidx"
ON "service_order_delivery_document" USING btree ("document_number","version");

ALTER TABLE "service_order_execution"
ADD COLUMN "technician_signature_data" jsonb,
ADD COLUMN "client_signature_data" jsonb;
