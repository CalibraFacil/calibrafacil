CREATE TABLE "service_order" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "unit_id" integer NOT NULL,
  "service_order_number" text NOT NULL,
  "customer_id" integer NOT NULL,
  "client_contact_id" integer,
  "client_contact_snapshot" jsonb,
  "asset_id" integer NOT NULL,
  "intake_type" text DEFAULT 'counter' NOT NULL,
  "source_service_order_id" integer,
  "status" text DEFAULT 'opened' NOT NULL,
  "priority" text DEFAULT 'normal' NOT NULL,
  "opened_at" timestamp DEFAULT now() NOT NULL,
  "opened_by_user_id" text NOT NULL,
  "responsible_technician_id" text,
  "evaluated_at" timestamp,
  "quoted_at" timestamp,
  "approved_at" timestamp,
  "rejected_at" timestamp,
  "repair_started_at" timestamp,
  "repair_finished_at" timestamp,
  "ready_at" timestamp,
  "delivered_at" timestamp,
  "delivered_to_name" text,
  "delivered_to_document" text,
  "delivery_notes" text,
  "closed_at" timestamp,
  "canceled_at" timestamp,
  "cancel_reason" text,
  "claimed_defect" text NOT NULL,
  "intake_condition" text NOT NULL,
  "accessories" text,
  "old_seal_number" text,
  "new_seal_number" text,
  "repaired_seal_number" text,
  "inmetro_repair_seal_number" text,
  "invoice_remittance_number" text,
  "invoice_remittance_key" text,
  "invoice_remittance_issued_at" timestamp,
  "carrier_name" text,
  "carrier_document" text,
  "third_party_name" text,
  "third_party_document" text,
  "third_party_phone" text,
  "delivery_method" text DEFAULT 'pickup_at_lab' NOT NULL,
  "internal_notes" text,
  "client_visible_notes" text,
  "total_quoted_cents" integer DEFAULT 0 NOT NULL,
  "total_approved_cents" integer DEFAULT 0 NOT NULL,
  "evaluation_fee_cents" integer DEFAULT 0 NOT NULL,
  "evaluation_fee_applied" boolean DEFAULT false NOT NULL,
  "warranty_until" timestamp,
  "warranty_terms" text,
  "closing_reason" text,
  "billing_document_id" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_order_asset_snapshot" (
  "id" serial PRIMARY KEY NOT NULL,
  "service_order_id" integer NOT NULL,
  "asset_id" integer NOT NULL,
  "asset_name" text NOT NULL,
  "asset_type" text,
  "manufacturer" text,
  "model" text,
  "serial_number" text,
  "patrimony_number" text,
  "capacity" text,
  "resolution" text,
  "inventory_code" text,
  "client_asset_code" text,
  "observed_identification" text,
  "photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "specifications" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_order_intake_document" (
  "id" serial PRIMARY KEY NOT NULL,
  "service_order_id" integer NOT NULL,
  "document_number" text NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "type" text DEFAULT 'combined' NOT NULL,
  "pdf_r2_key" text,
  "issued_at" timestamp,
  "issued_by_user_id" text,
  "access_token_hash" text,
  "qr_code_payload" text,
  "signature_data" jsonb,
  "canceled_at" timestamp,
  "canceled_reason" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_order_tag" (
  "id" serial PRIMARY KEY NOT NULL,
  "service_order_id" integer NOT NULL,
  "tag_number" text NOT NULL,
  "label_template_id" integer,
  "pdf_r2_key" text,
  "printed_at" timestamp,
  "printed_by_user_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_order_evaluation" (
  "id" serial PRIMARY KEY NOT NULL,
  "service_order_id" integer NOT NULL,
  "technician_id" text NOT NULL,
  "evaluated_at" timestamp DEFAULT now() NOT NULL,
  "diagnosis" text NOT NULL,
  "detected_issues" text,
  "recommended_action" text NOT NULL,
  "requires_quote" boolean DEFAULT true NOT NULL,
  "requires_client_approval" boolean DEFAULT true NOT NULL,
  "calibration_recommended" boolean DEFAULT false NOT NULL,
  "photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "internal_notes" text,
  "client_visible_notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_order_quote" (
  "id" serial PRIMARY KEY NOT NULL,
  "service_order_id" integer NOT NULL,
  "quote_number" text NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "subtotal_services_cents" integer DEFAULT 0 NOT NULL,
  "subtotal_parts_cents" integer DEFAULT 0 NOT NULL,
  "discount_cents" integer DEFAULT 0 NOT NULL,
  "freight_cents" integer DEFAULT 0 NOT NULL,
  "total_cents" integer DEFAULT 0 NOT NULL,
  "valid_until" timestamp,
  "payment_terms" text,
  "delivery_estimate" text,
  "warranty_terms" text,
  "client_message" text,
  "internal_notes" text,
  "sent_at" timestamp,
  "sent_by_user_id" text,
  "approved_at" timestamp,
  "approved_by_portal_user_id" text,
  "approved_manually_by_user_id" text,
  "manual_approval_by_name" text,
  "manual_approval_evidence_type" text,
  "manual_approval_evidence_text" text,
  "rejected_at" timestamp,
  "rejection_reason" text,
  "pdf_r2_key" text,
  "portal_access_token_hash" text,
  "created_by_user_id" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_order_quote_item" (
  "id" serial PRIMARY KEY NOT NULL,
  "quote_id" integer NOT NULL,
  "type" text NOT NULL,
  "description" text NOT NULL,
  "quantity" real DEFAULT 1 NOT NULL,
  "unit" text DEFAULT 'un' NOT NULL,
  "unit_price_cents" integer NOT NULL,
  "total_price_cents" integer NOT NULL,
  "taxable" boolean DEFAULT true NOT NULL,
  "warranty_covered" boolean DEFAULT false NOT NULL,
  "warranty_until" timestamp,
  "warranty_terms" text,
  "notes" text,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_order_execution" (
  "id" serial PRIMARY KEY NOT NULL,
  "service_order_id" integer NOT NULL,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "started_by_user_id" text NOT NULL,
  "finished_at" timestamp,
  "finished_by_user_id" text,
  "service_performed" text,
  "parts_used_summary" text,
  "technical_notes" text,
  "calibration_required_after_repair" boolean DEFAULT false NOT NULL,
  "result" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_order_execution_item" (
  "id" serial PRIMARY KEY NOT NULL,
  "execution_id" integer NOT NULL,
  "quote_item_id" integer,
  "type" text NOT NULL,
  "description" text NOT NULL,
  "quantity" real DEFAULT 1 NOT NULL,
  "unit" text DEFAULT 'un' NOT NULL,
  "unit_cost_cents" integer DEFAULT 0 NOT NULL,
  "unit_price_cents" integer NOT NULL,
  "total_price_cents" integer NOT NULL,
  "technician_id" text,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_order_event_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "unit_id" integer NOT NULL,
  "service_order_id" integer NOT NULL,
  "actor_type" text NOT NULL,
  "actor_id" text,
  "event_type" text NOT NULL,
  "old_value" jsonb,
  "new_value" jsonb,
  "metadata" jsonb,
  "ip_address" text,
  "user_agent" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_order_attachment" (
  "id" serial PRIMARY KEY NOT NULL,
  "service_order_id" integer NOT NULL,
  "uploaded_by_user_id" text,
  "filename" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "r2_key" text NOT NULL,
  "visibility" text DEFAULT 'internal' NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_order_certificate_link" (
  "id" serial PRIMARY KEY NOT NULL,
  "service_order_id" integer NOT NULL,
  "certificate_job_id" integer NOT NULL,
  "linked_by_user_id" text NOT NULL,
  "linked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_order_settings" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "numbering_template" text DEFAULT 'OS-{YYYY}-{SEQ}' NOT NULL,
  "numbering_scope" text DEFAULT 'unit' NOT NULL,
  "default_intake_terms" text,
  "default_quote_terms" text,
  "require_photo_on_intake" boolean DEFAULT false NOT NULL,
  "require_invoice_or_justification" boolean DEFAULT false NOT NULL,
  "allow_public_quote_approval" boolean DEFAULT true NOT NULL,
  "require_portal_login_for_approval" boolean DEFAULT false NOT NULL,
  "auto_email_on_open" boolean DEFAULT true NOT NULL,
  "auto_email_on_quote_sent" boolean DEFAULT true NOT NULL,
  "auto_email_on_ready" boolean DEFAULT true NOT NULL,
  "auto_email_on_close" boolean DEFAULT false NOT NULL,
  "show_values_in_portal" boolean DEFAULT true NOT NULL,
  "default_quote_validity_days" integer DEFAULT 15 NOT NULL,
  "default_warranty_terms" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_order_numbering_sequence" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "unit_id" integer,
  "sequence_key" text NOT NULL,
  "current_value" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_order_public_access_token" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "service_order_id" integer NOT NULL,
  "quote_id" integer,
  "token_hash" text NOT NULL,
  "scope" text DEFAULT 'service_order' NOT NULL,
  "expires_at" timestamp,
  "revoked_at" timestamp,
  "last_viewed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_document_item" ADD COLUMN "service_order_id" integer;
--> statement-breakpoint
ALTER TABLE "service_order" ADD CONSTRAINT "service_order_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "service_order" ADD CONSTRAINT "service_order_unit_id_organization_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "organization_unit"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "service_order" ADD CONSTRAINT "service_order_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "service_order" ADD CONSTRAINT "service_order_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "asset"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "service_order" ADD CONSTRAINT "service_order_opened_by_user_id_user_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "user"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "service_order" ADD CONSTRAINT "service_order_responsible_technician_id_user_id_fk" FOREIGN KEY ("responsible_technician_id") REFERENCES "user"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "service_order" ADD CONSTRAINT "service_order_billing_document_id_billing_document_id_fk" FOREIGN KEY ("billing_document_id") REFERENCES "billing_document"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "service_order_asset_snapshot" ADD CONSTRAINT "service_order_asset_snapshot_service_order_id_fk" FOREIGN KEY ("service_order_id") REFERENCES "service_order"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "service_order_asset_snapshot" ADD CONSTRAINT "service_order_asset_snapshot_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "asset"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "service_order_intake_document" ADD CONSTRAINT "service_order_intake_document_order_fk" FOREIGN KEY ("service_order_id") REFERENCES "service_order"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "service_order_tag" ADD CONSTRAINT "service_order_tag_order_fk" FOREIGN KEY ("service_order_id") REFERENCES "service_order"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "service_order_evaluation" ADD CONSTRAINT "service_order_evaluation_order_fk" FOREIGN KEY ("service_order_id") REFERENCES "service_order"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "service_order_quote" ADD CONSTRAINT "service_order_quote_order_fk" FOREIGN KEY ("service_order_id") REFERENCES "service_order"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "service_order_quote_item" ADD CONSTRAINT "service_order_quote_item_quote_fk" FOREIGN KEY ("quote_id") REFERENCES "service_order_quote"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "service_order_execution" ADD CONSTRAINT "service_order_execution_order_fk" FOREIGN KEY ("service_order_id") REFERENCES "service_order"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "service_order_execution_item" ADD CONSTRAINT "service_order_execution_item_execution_fk" FOREIGN KEY ("execution_id") REFERENCES "service_order_execution"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "service_order_event_log" ADD CONSTRAINT "service_order_event_order_fk" FOREIGN KEY ("service_order_id") REFERENCES "service_order"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "service_order_attachment" ADD CONSTRAINT "service_order_attachment_order_fk" FOREIGN KEY ("service_order_id") REFERENCES "service_order"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "service_order_certificate_link" ADD CONSTRAINT "service_order_certificate_link_order_fk" FOREIGN KEY ("service_order_id") REFERENCES "service_order"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "service_order_certificate_link" ADD CONSTRAINT "service_order_certificate_link_job_fk" FOREIGN KEY ("certificate_job_id") REFERENCES "calibration_job"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "service_order_settings" ADD CONSTRAINT "service_order_settings_org_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "service_order_numbering_sequence" ADD CONSTRAINT "service_order_numbering_sequence_org_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "service_order_public_access_token" ADD CONSTRAINT "service_order_public_access_token_order_fk" FOREIGN KEY ("service_order_id") REFERENCES "service_order"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "service_order_public_access_token" ADD CONSTRAINT "service_order_public_access_token_quote_fk" FOREIGN KEY ("quote_id") REFERENCES "service_order_quote"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "service_order_org_number_uidx" ON "service_order" ("organization_id","service_order_number");
--> statement-breakpoint
CREATE INDEX "service_order_org_status_opened_idx" ON "service_order" ("organization_id","status","opened_at");
--> statement-breakpoint
CREATE INDEX "service_order_unit_status_idx" ON "service_order" ("unit_id","status");
--> statement-breakpoint
CREATE INDEX "service_order_customer_idx" ON "service_order" ("customer_id");
--> statement-breakpoint
CREATE INDEX "service_order_asset_idx" ON "service_order" ("asset_id");
--> statement-breakpoint
CREATE INDEX "service_order_technician_idx" ON "service_order" ("responsible_technician_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "service_order_asset_snapshot_order_uidx" ON "service_order_asset_snapshot" ("service_order_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "service_order_settings_org_uidx" ON "service_order_settings" ("organization_id");
--> statement-breakpoint
CREATE INDEX "service_order_event_order_created_idx" ON "service_order_event_log" ("service_order_id","created_at");
--> statement-breakpoint
CREATE INDEX "service_order_event_type_idx" ON "service_order_event_log" ("event_type");
--> statement-breakpoint
CREATE UNIQUE INDEX "service_order_numbering_sequence_uidx" ON "service_order_numbering_sequence" ("organization_id","unit_id","sequence_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "service_order_public_access_token_hash_uidx" ON "service_order_public_access_token" ("token_hash");
