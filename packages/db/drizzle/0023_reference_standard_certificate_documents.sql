CREATE TABLE IF NOT EXISTS "reference_standard_certificate_document" (
  "id" serial PRIMARY KEY NOT NULL,
  "standard_id" integer NOT NULL,
  "organization_id" text NOT NULL,
  "unit_id" integer NOT NULL,
  "certificate_number" text NOT NULL,
  "calibration_date" timestamp NOT NULL,
  "next_calibration_date" timestamp NOT NULL,
  "file_name" text NOT NULL,
  "content_type" text NOT NULL,
  "file_size" integer NOT NULL,
  "sha256" text NOT NULL,
  "r2_key" text NOT NULL,
  "is_current" boolean DEFAULT true NOT NULL,
  "uploaded_by" text,
  "uploaded_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "reference_standard_certificate_document_standard_id_reference_standard_id_fk"
    FOREIGN KEY ("standard_id") REFERENCES "public"."reference_standard"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "reference_standard_certificate_document_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "reference_standard_certificate_document_unit_id_organization_unit_id_fk"
    FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "reference_standard_certificate_document_uploaded_by_user_id_fk"
    FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "standard_certificate_document_standard_idx"
  ON "reference_standard_certificate_document" USING btree ("standard_id");

CREATE INDEX IF NOT EXISTS "standard_certificate_document_org_idx"
  ON "reference_standard_certificate_document" USING btree ("organization_id");

CREATE INDEX IF NOT EXISTS "standard_certificate_document_unit_idx"
  ON "reference_standard_certificate_document" USING btree ("unit_id");

CREATE INDEX IF NOT EXISTS "standard_certificate_document_current_idx"
  ON "reference_standard_certificate_document" USING btree ("standard_id", "is_current");

CREATE UNIQUE INDEX IF NOT EXISTS "standard_certificate_document_one_current_uidx"
  ON "reference_standard_certificate_document" ("standard_id")
  WHERE "is_current" = true;
