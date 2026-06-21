CREATE TABLE "account_interaction" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"channel" text DEFAULT 'note' NOT NULL,
	"direction" text DEFAULT 'outbound' NOT NULL,
	"summary" text NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_task" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"type" text DEFAULT 'GENERAL' NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"owner_user_id" text,
	"due_at" timestamp,
	"notes" text,
	"created_by_user_id" text,
	"completed_at" timestamp,
	"completed_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_queue_job" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"available_at" timestamp DEFAULT now() NOT NULL,
	"locked_by" text,
	"locked_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_request" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"summary" text NOT NULL,
	"amount_cents" integer,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"requested_by_user_id" text,
	"decided_by_user_id" text,
	"decision_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"decided_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "authorized_signatory" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"asset_type_id" integer,
	"scope_description" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"authorized_by" text NOT NULL,
	"authorized_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"revoked_by" text,
	"revoked_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "authorized_signatory_org_user_asset_type_uidx" UNIQUE NULLS NOT DISTINCT("organization_id","user_id","asset_type_id")
);
--> statement-breakpoint
CREATE TABLE "authorized_signatory_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"signatory_id" integer NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "automatic_send_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"service_order_id" integer,
	"applied_rule_id" integer,
	"milestone" text NOT NULL,
	"outcome" text NOT NULL,
	"actor_user_id" text,
	"reason" text,
	"provider_response_summary" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automatic_send_rule" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"milestone" text NOT NULL,
	"customer_id" integer,
	"commercial_agreement_id" integer,
	"service_category" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "billing_group" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"customer_id" integer NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"payment_term_days" integer DEFAULT 28 NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"billing_period_from" timestamp,
	"billing_period_to" timestamp,
	"notes" text,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_group_service_order" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"service_order_id" integer NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calibration_visit" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"unit_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"source_request_id" integer,
	"technician_id" text,
	"status" text DEFAULT 'PROPOSED' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"scheduled_end_at" timestamp with time zone,
	"address" jsonb,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text
);
--> statement-breakpoint
CREATE TABLE "certificate_numbering_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"profile_id" integer,
	"action" text NOT NULL,
	"changes" jsonb,
	"performed_by" text,
	"ip_address" text,
	"performed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificate_numbering_profile" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text DEFAULT 'Padrao' NOT NULL,
	"config" jsonb NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificate_numbering_sequence" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"profile_id" integer NOT NULL,
	"sequence_key" text NOT NULL,
	"current_value" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificate_release" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"calibration_job_id" integer NOT NULL,
	"status" text NOT NULL,
	"applied_policy_id" integer,
	"last_evaluated_at" timestamp DEFAULT now() NOT NULL,
	"payment_state_snapshot" jsonb DEFAULT 'null'::jsonb,
	"released_by_user_id" text,
	"release_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificate_release_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"certificate_release_id" integer NOT NULL,
	"actor_user_id" text,
	"from_status" text,
	"to_status" text NOT NULL,
	"applied_policy_id" integer,
	"payment_state_snapshot" jsonb,
	"reason" text,
	"source" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificate_release_policy" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"mode" text NOT NULL,
	"customer_id" integer,
	"commercial_agreement_id" integer,
	"service_category" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "certificate_template_assignment" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"template_id" integer NOT NULL,
	"template_version_id" integer NOT NULL,
	"unit_id" integer,
	"service_id" integer,
	"method_id" integer,
	"certificate_type" text DEFAULT 'calibration' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificate_template_preview" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"template_version_id" integer NOT NULL,
	"sample_data" jsonb,
	"filled_xlsx_r2_key" text,
	"pdf_r2_key" text,
	"pdf_sha256" text,
	"render_metadata" jsonb,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"error" text,
	"requested_by" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificate_template_version" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"template_id" integer NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"xlsx_r2_key" text NOT NULL,
	"xlsx_sha256" text NOT NULL,
	"binding_manifest" jsonb NOT NULL,
	"binding_manifest_sha256" text NOT NULL,
	"render_policy" jsonb NOT NULL,
	"analysis" jsonb,
	"validation_result" jsonb,
	"created_by" text NOT NULL,
	"published_at" timestamp,
	"published_by" text,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_group" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"auth_organization_id" text NOT NULL,
	"lab_organization_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entitlement_override" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"feature" text NOT NULL,
	"reason" text,
	"expires_at" timestamp,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_run" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"entity" text NOT NULL,
	"file_name" text,
	"status" text DEFAULT 'VALIDATED' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"valid_rows" integer DEFAULT 0 NOT NULL,
	"error_rows" integer DEFAULT 0 NOT NULL,
	"mapping" jsonb,
	"errors_sample" jsonb,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_sync_cursor" (
	"id" serial PRIMARY KEY NOT NULL,
	"integration_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"cursor_type" text NOT NULL,
	"last_remote_updated_at" timestamp,
	"last_successful_poll_at" timestamp,
	"next_page" integer,
	"state" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_sync_item" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"target" text NOT NULL,
	"local_entity_id" text NOT NULL,
	"remote_entity_id" text,
	"operation" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"last_error_message" text,
	"request_fingerprint" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issued_certificate_snapshot" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"job_id" integer NOT NULL,
	"template_id" integer NOT NULL,
	"template_version_id" integer NOT NULL,
	"certificate_number" text,
	"filled_xlsx_r2_key" text NOT NULL,
	"filled_xlsx_sha256" text NOT NULL,
	"pdf_r2_key" text NOT NULL,
	"pdf_sha256" text NOT NULL,
	"binding_manifest_sha256" text NOT NULL,
	"render_policy" jsonb NOT NULL,
	"render_metadata" jsonb,
	"input_data_snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'ISSUED' NOT NULL,
	"issued_by" text,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"superseded_by_id" integer,
	"voided_at" timestamp,
	"voided_by" text,
	"void_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_account_setup_token" (
	"id" text PRIMARY KEY NOT NULL,
	"secret_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"invitation_id" text,
	"email" text NOT NULL,
	"purpose" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"created_by_user_id" text,
	"source" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mass_composition_profile" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"profile_key" text NOT NULL,
	"profile_class" text NOT NULL,
	"nominal_g" double precision NOT NULL,
	"nominal" text NOT NULL,
	"value" double precision NOT NULL,
	"uncertainty" double precision NOT NULL,
	"unit" text DEFAULT 'g' NOT NULL,
	"max_error" double precision,
	"drift" double precision,
	"buoyancy" double precision,
	"coverage_factor" double precision,
	"quantity_available" integer,
	"source_standard_id" integer,
	"source_certificate" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "operator_alert" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text,
	"dedupe_key" text NOT NULL,
	"kind" text NOT NULL,
	"severity" text DEFAULT 'warning' NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"acknowledged_by_user_id" text,
	"acknowledged_at" timestamp,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "operator_alert_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE "reference_standard_certificate_document" (
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
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_order" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"unit_id" integer NOT NULL,
	"service_order_number" text NOT NULL,
	"public_id" text DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" integer NOT NULL,
	"client_contact_id" integer,
	"client_contact_snapshot" jsonb,
	"asset_id" integer NOT NULL,
	"intake_type" text DEFAULT 'counter' NOT NULL,
	"source_service_order_id" integer,
	"is_external_service" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'opened' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"service_started_at" timestamp,
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
	"inmetro_repair_seal_issued_at" timestamp,
	"inmetro_repair_seal_applied_at" timestamp,
	"inmetro_repair_seal_applied_by_user_id" text,
	"inmetro_repair_seal_notes" text,
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
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "service_order_public_id_unique" UNIQUE("public_id")
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
	"display_specs" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "service_order_asset_snapshot_service_order_id_unique" UNIQUE("service_order_id")
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
--> statement-breakpoint
CREATE TABLE "service_order_email_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_order_id" integer NOT NULL,
	"event_key" text NOT NULL,
	"recipient_email" text,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "service_order_email_log_so_event_uidx" UNIQUE("service_order_id","event_key")
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
	"technician_signature_data" jsonb,
	"client_signature_data" jsonb,
	"calibration_required_after_repair" boolean DEFAULT false NOT NULL,
	"result" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "service_order_execution_service_order_id_unique" UNIQUE("service_order_id")
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
CREATE TABLE "service_order_numbering_sequence" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"unit_id" integer,
	"sequence_key" text NOT NULL,
	"current_value" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "service_order_numbering_sequence_uidx" UNIQUE NULLS NOT DISTINCT("organization_id","unit_id","sequence_key")
);
--> statement-breakpoint
CREATE TABLE "service_order_outsourced_cost" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"service_order_id" integer NOT NULL,
	"supplier_name" text NOT NULL,
	"expected_cost_cents" integer NOT NULL,
	"actual_cost_cents" integer,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"payable_link_id" text,
	"notes" text,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"voided_at" timestamp
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
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "service_order_settings_organization_id_unique" UNIQUE("organization_id")
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
CREATE TABLE "twoFactor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "base_measurement_unit" text;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "subject_to_legal_metrology" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_document" ADD COLUMN "public_id" text DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_document_item" ADD COLUMN "service_order_id" integer;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD COLUMN "certificate_name" text;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD COLUMN "certificate_numbering_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD COLUMN "visit_id" integer;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD COLUMN "calibration_location_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD COLUMN "calibration_phase_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD COLUMN "signature_verdict" jsonb;--> statement-breakpoint
ALTER TABLE "calibration_method" ADD COLUMN "accredited_scope" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "calibration_method" ADD COLUMN "variable_bindings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "calibration_method" ADD COLUMN "measurement_models" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "calibration_method" ADD COLUMN "compiled_method" jsonb;--> statement-breakpoint
ALTER TABLE "calibration_method" ADD COLUMN "method_fingerprint" text;--> statement-breakpoint
ALTER TABLE "calibration_method" ADD COLUMN "method_engine" jsonb;--> statement-breakpoint
ALTER TABLE "calibration_method" ADD COLUMN "method_compiled_at" timestamp;--> statement-breakpoint
ALTER TABLE "calibration_method" ADD COLUMN "publication_evidence" jsonb;--> statement-breakpoint
ALTER TABLE "calibration_method" ADD COLUMN "template_key" text;--> statement-breakpoint
ALTER TABLE "calibration_method" ADD COLUMN "template_version" integer;--> statement-breakpoint
ALTER TABLE "calibration_request" ADD COLUMN "delivery_method" text DEFAULT 'dropoff' NOT NULL;--> statement-breakpoint
ALTER TABLE "calibration_request" ADD COLUMN "invoice_remittance_number" text;--> statement-breakpoint
ALTER TABLE "calibration_request" ADD COLUMN "invoice_remittance_key" text;--> statement-breakpoint
ALTER TABLE "calibration_request" ADD COLUMN "invoice_remittance_issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calibration_request" ADD COLUMN "carrier_name" text;--> statement-breakpoint
ALTER TABLE "calibration_request" ADD COLUMN "onsite_address" jsonb;--> statement-breakpoint
ALTER TABLE "calibration_request" ADD COLUMN "preferred_visit_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "group_id" integer;--> statement-breakpoint
ALTER TABLE "integration_object_link" ADD COLUMN "remote_entity_type" text;--> statement-breakpoint
ALTER TABLE "integration_object_link" ADD COLUMN "remote_legacy_id" text;--> statement-breakpoint
ALTER TABLE "integration_object_link" ADD COLUMN "remote_version" integer;--> statement-breakpoint
ALTER TABLE "integration_object_link" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "integration_object_link" ADD COLUMN "drift_acknowledged_at" timestamp;--> statement-breakpoint
ALTER TABLE "integration_object_link" ADD COLUMN "drift_acknowledged_by_user_id" text;--> statement-breakpoint
ALTER TABLE "integration_object_link" ADD COLUMN "drift_acknowledged_reason" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "status" text DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "suspended_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "suspension_reason" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "deletion_scheduled_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "accreditation_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reference_standard" ADD COLUMN "kind" text DEFAULT 'generic_scalar' NOT NULL;--> statement-breakpoint
ALTER TABLE "reference_standard" ADD COLUMN "metrology_data" jsonb;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "two_factor_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "account_interaction" ADD CONSTRAINT "account_interaction_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_interaction" ADD CONSTRAINT "account_interaction_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_task" ADD CONSTRAINT "account_task_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_task" ADD CONSTRAINT "account_task_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_task" ADD CONSTRAINT "account_task_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_task" ADD CONSTRAINT "account_task_completed_by_user_id_user_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorized_signatory" ADD CONSTRAINT "authorized_signatory_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorized_signatory" ADD CONSTRAINT "authorized_signatory_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorized_signatory" ADD CONSTRAINT "authorized_signatory_asset_type_id_asset_type_id_fk" FOREIGN KEY ("asset_type_id") REFERENCES "public"."asset_type"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorized_signatory" ADD CONSTRAINT "authorized_signatory_authorized_by_user_id_fk" FOREIGN KEY ("authorized_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorized_signatory" ADD CONSTRAINT "authorized_signatory_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorized_signatory_audit_log" ADD CONSTRAINT "authorized_signatory_audit_log_signatory_id_authorized_signatory_id_fk" FOREIGN KEY ("signatory_id") REFERENCES "public"."authorized_signatory"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automatic_send_audit_log" ADD CONSTRAINT "automatic_send_audit_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automatic_send_audit_log" ADD CONSTRAINT "automatic_send_audit_log_service_order_id_service_order_id_fk" FOREIGN KEY ("service_order_id") REFERENCES "public"."service_order"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automatic_send_audit_log" ADD CONSTRAINT "automatic_send_audit_log_applied_rule_id_automatic_send_rule_id_fk" FOREIGN KEY ("applied_rule_id") REFERENCES "public"."automatic_send_rule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automatic_send_audit_log" ADD CONSTRAINT "automatic_send_audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automatic_send_rule" ADD CONSTRAINT "automatic_send_rule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automatic_send_rule" ADD CONSTRAINT "automatic_send_rule_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automatic_send_rule" ADD CONSTRAINT "automatic_send_rule_commercial_agreement_id_commercial_agreement_id_fk" FOREIGN KEY ("commercial_agreement_id") REFERENCES "public"."commercial_agreement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automatic_send_rule" ADD CONSTRAINT "automatic_send_rule_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_group" ADD CONSTRAINT "billing_group_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_group" ADD CONSTRAINT "billing_group_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_group" ADD CONSTRAINT "billing_group_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_group_service_order" ADD CONSTRAINT "billing_group_service_order_group_id_billing_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."billing_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_group_service_order" ADD CONSTRAINT "billing_group_service_order_service_order_id_service_order_id_fk" FOREIGN KEY ("service_order_id") REFERENCES "public"."service_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_visit" ADD CONSTRAINT "calibration_visit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_visit" ADD CONSTRAINT "calibration_visit_unit_id_organization_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_visit" ADD CONSTRAINT "calibration_visit_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_visit" ADD CONSTRAINT "calibration_visit_source_request_id_calibration_request_id_fk" FOREIGN KEY ("source_request_id") REFERENCES "public"."calibration_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_visit" ADD CONSTRAINT "calibration_visit_technician_id_user_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_visit" ADD CONSTRAINT "calibration_visit_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_visit" ADD CONSTRAINT "calibration_visit_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_visit" ADD CONSTRAINT "calibration_visit_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_numbering_audit_log" ADD CONSTRAINT "certificate_numbering_audit_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_numbering_audit_log" ADD CONSTRAINT "certificate_numbering_audit_log_profile_id_certificate_numbering_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."certificate_numbering_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_numbering_audit_log" ADD CONSTRAINT "certificate_numbering_audit_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_numbering_profile" ADD CONSTRAINT "certificate_numbering_profile_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_numbering_profile" ADD CONSTRAINT "certificate_numbering_profile_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_numbering_profile" ADD CONSTRAINT "certificate_numbering_profile_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_numbering_sequence" ADD CONSTRAINT "certificate_numbering_sequence_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_numbering_sequence" ADD CONSTRAINT "certificate_numbering_sequence_profile_id_certificate_numbering_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."certificate_numbering_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_release" ADD CONSTRAINT "certificate_release_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_release" ADD CONSTRAINT "certificate_release_calibration_job_id_calibration_job_id_fk" FOREIGN KEY ("calibration_job_id") REFERENCES "public"."calibration_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_release" ADD CONSTRAINT "certificate_release_applied_policy_id_certificate_release_policy_id_fk" FOREIGN KEY ("applied_policy_id") REFERENCES "public"."certificate_release_policy"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_release" ADD CONSTRAINT "certificate_release_released_by_user_id_user_id_fk" FOREIGN KEY ("released_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_release_audit_log" ADD CONSTRAINT "certificate_release_audit_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_release_audit_log" ADD CONSTRAINT "certificate_release_audit_log_certificate_release_id_certificate_release_id_fk" FOREIGN KEY ("certificate_release_id") REFERENCES "public"."certificate_release"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_release_audit_log" ADD CONSTRAINT "certificate_release_audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_release_audit_log" ADD CONSTRAINT "certificate_release_audit_log_applied_policy_id_certificate_release_policy_id_fk" FOREIGN KEY ("applied_policy_id") REFERENCES "public"."certificate_release_policy"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_release_policy" ADD CONSTRAINT "certificate_release_policy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_release_policy" ADD CONSTRAINT "certificate_release_policy_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_release_policy" ADD CONSTRAINT "certificate_release_policy_commercial_agreement_id_commercial_agreement_id_fk" FOREIGN KEY ("commercial_agreement_id") REFERENCES "public"."commercial_agreement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_release_policy" ADD CONSTRAINT "certificate_release_policy_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_template_assignment" ADD CONSTRAINT "certificate_template_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_template_assignment" ADD CONSTRAINT "certificate_template_assignment_template_id_certificate_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."certificate_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_template_assignment" ADD CONSTRAINT "certificate_template_assignment_template_version_id_certificate_template_version_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."certificate_template_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_template_assignment" ADD CONSTRAINT "certificate_template_assignment_unit_id_organization_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_template_assignment" ADD CONSTRAINT "certificate_template_assignment_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_template_assignment" ADD CONSTRAINT "certificate_template_assignment_method_id_calibration_method_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."calibration_method"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_template_assignment" ADD CONSTRAINT "certificate_template_assignment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_template_preview" ADD CONSTRAINT "certificate_template_preview_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_template_preview" ADD CONSTRAINT "certificate_template_preview_template_version_id_certificate_template_version_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."certificate_template_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_template_preview" ADD CONSTRAINT "certificate_template_preview_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_template_version" ADD CONSTRAINT "certificate_template_version_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_template_version" ADD CONSTRAINT "certificate_template_version_template_id_certificate_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."certificate_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_template_version" ADD CONSTRAINT "certificate_template_version_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_template_version" ADD CONSTRAINT "certificate_template_version_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_group" ADD CONSTRAINT "customer_group_auth_organization_id_organization_id_fk" FOREIGN KEY ("auth_organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_group" ADD CONSTRAINT "customer_group_lab_organization_id_organization_id_fk" FOREIGN KEY ("lab_organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_override" ADD CONSTRAINT "entitlement_override_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_override" ADD CONSTRAINT "entitlement_override_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_cursor" ADD CONSTRAINT "integration_sync_cursor_integration_id_organization_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."organization_integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_cursor" ADD CONSTRAINT "integration_sync_cursor_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_cursor" ADD CONSTRAINT "integration_sync_cursor_integration_org_fk" FOREIGN KEY ("integration_id","organization_id") REFERENCES "public"."organization_integration"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_item" ADD CONSTRAINT "integration_sync_item_run_id_integration_sync_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."integration_sync_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_item" ADD CONSTRAINT "integration_sync_item_integration_id_organization_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."organization_integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_item" ADD CONSTRAINT "integration_sync_item_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_item" ADD CONSTRAINT "integration_sync_item_integration_org_fk" FOREIGN KEY ("integration_id","organization_id") REFERENCES "public"."organization_integration"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_certificate_snapshot" ADD CONSTRAINT "issued_certificate_snapshot_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_certificate_snapshot" ADD CONSTRAINT "issued_certificate_snapshot_job_id_calibration_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."calibration_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_certificate_snapshot" ADD CONSTRAINT "issued_certificate_snapshot_template_id_certificate_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."certificate_template"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_certificate_snapshot" ADD CONSTRAINT "issued_certificate_snapshot_template_version_id_certificate_template_version_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."certificate_template_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_certificate_snapshot" ADD CONSTRAINT "issued_certificate_snapshot_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_certificate_snapshot" ADD CONSTRAINT "issued_certificate_snapshot_voided_by_user_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_account_setup_token" ADD CONSTRAINT "lab_account_setup_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_account_setup_token" ADD CONSTRAINT "lab_account_setup_token_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_account_setup_token" ADD CONSTRAINT "lab_account_setup_token_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_account_setup_token" ADD CONSTRAINT "lab_account_setup_token_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mass_composition_profile" ADD CONSTRAINT "mass_composition_profile_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mass_composition_profile" ADD CONSTRAINT "mass_composition_profile_source_standard_id_reference_standard_id_fk" FOREIGN KEY ("source_standard_id") REFERENCES "public"."reference_standard"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_alert" ADD CONSTRAINT "operator_alert_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_alert" ADD CONSTRAINT "operator_alert_acknowledged_by_user_id_user_id_fk" FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_standard_certificate_document" ADD CONSTRAINT "reference_standard_certificate_document_standard_id_reference_standard_id_fk" FOREIGN KEY ("standard_id") REFERENCES "public"."reference_standard"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_standard_certificate_document" ADD CONSTRAINT "reference_standard_certificate_document_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_standard_certificate_document" ADD CONSTRAINT "reference_standard_certificate_document_unit_id_organization_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_standard_certificate_document" ADD CONSTRAINT "reference_standard_certificate_document_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order" ADD CONSTRAINT "service_order_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order" ADD CONSTRAINT "service_order_unit_id_organization_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order" ADD CONSTRAINT "service_order_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order" ADD CONSTRAINT "service_order_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order" ADD CONSTRAINT "service_order_opened_by_user_id_user_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order" ADD CONSTRAINT "service_order_responsible_technician_id_user_id_fk" FOREIGN KEY ("responsible_technician_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order" ADD CONSTRAINT "service_order_inmetro_repair_seal_applied_by_user_id_user_id_fk" FOREIGN KEY ("inmetro_repair_seal_applied_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order" ADD CONSTRAINT "service_order_billing_document_id_billing_document_id_fk" FOREIGN KEY ("billing_document_id") REFERENCES "public"."billing_document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_asset_snapshot" ADD CONSTRAINT "service_order_asset_snapshot_service_order_id_service_order_id_fk" FOREIGN KEY ("service_order_id") REFERENCES "public"."service_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_asset_snapshot" ADD CONSTRAINT "service_order_asset_snapshot_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_attachment" ADD CONSTRAINT "service_order_attachment_service_order_id_service_order_id_fk" FOREIGN KEY ("service_order_id") REFERENCES "public"."service_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_attachment" ADD CONSTRAINT "service_order_attachment_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_certificate_link" ADD CONSTRAINT "service_order_certificate_link_service_order_id_service_order_id_fk" FOREIGN KEY ("service_order_id") REFERENCES "public"."service_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_certificate_link" ADD CONSTRAINT "service_order_certificate_link_certificate_job_id_calibration_job_id_fk" FOREIGN KEY ("certificate_job_id") REFERENCES "public"."calibration_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_certificate_link" ADD CONSTRAINT "service_order_certificate_link_linked_by_user_id_user_id_fk" FOREIGN KEY ("linked_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_delivery_document" ADD CONSTRAINT "service_order_delivery_document_service_order_id_service_order_id_fk" FOREIGN KEY ("service_order_id") REFERENCES "public"."service_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_delivery_document" ADD CONSTRAINT "service_order_delivery_document_issued_by_user_id_user_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_email_log" ADD CONSTRAINT "service_order_email_log_service_order_id_service_order_id_fk" FOREIGN KEY ("service_order_id") REFERENCES "public"."service_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_evaluation" ADD CONSTRAINT "service_order_evaluation_service_order_id_service_order_id_fk" FOREIGN KEY ("service_order_id") REFERENCES "public"."service_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_evaluation" ADD CONSTRAINT "service_order_evaluation_technician_id_user_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_event_log" ADD CONSTRAINT "service_order_event_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_event_log" ADD CONSTRAINT "service_order_event_log_unit_id_organization_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_event_log" ADD CONSTRAINT "service_order_event_log_service_order_id_service_order_id_fk" FOREIGN KEY ("service_order_id") REFERENCES "public"."service_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_execution" ADD CONSTRAINT "service_order_execution_service_order_id_service_order_id_fk" FOREIGN KEY ("service_order_id") REFERENCES "public"."service_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_execution" ADD CONSTRAINT "service_order_execution_started_by_user_id_user_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_execution" ADD CONSTRAINT "service_order_execution_finished_by_user_id_user_id_fk" FOREIGN KEY ("finished_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_execution_item" ADD CONSTRAINT "service_order_execution_item_execution_id_service_order_execution_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."service_order_execution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_execution_item" ADD CONSTRAINT "service_order_execution_item_quote_item_id_service_order_quote_item_id_fk" FOREIGN KEY ("quote_item_id") REFERENCES "public"."service_order_quote_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_execution_item" ADD CONSTRAINT "service_order_execution_item_technician_id_user_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_intake_document" ADD CONSTRAINT "service_order_intake_document_service_order_id_service_order_id_fk" FOREIGN KEY ("service_order_id") REFERENCES "public"."service_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_intake_document" ADD CONSTRAINT "service_order_intake_document_issued_by_user_id_user_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_numbering_sequence" ADD CONSTRAINT "service_order_numbering_sequence_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_numbering_sequence" ADD CONSTRAINT "service_order_numbering_sequence_unit_id_organization_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_outsourced_cost" ADD CONSTRAINT "service_order_outsourced_cost_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_outsourced_cost" ADD CONSTRAINT "service_order_outsourced_cost_service_order_id_service_order_id_fk" FOREIGN KEY ("service_order_id") REFERENCES "public"."service_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_outsourced_cost" ADD CONSTRAINT "service_order_outsourced_cost_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_public_access_token" ADD CONSTRAINT "service_order_public_access_token_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_public_access_token" ADD CONSTRAINT "service_order_public_access_token_service_order_id_service_order_id_fk" FOREIGN KEY ("service_order_id") REFERENCES "public"."service_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_public_access_token" ADD CONSTRAINT "service_order_public_access_token_quote_id_service_order_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."service_order_quote"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_quote" ADD CONSTRAINT "service_order_quote_service_order_id_service_order_id_fk" FOREIGN KEY ("service_order_id") REFERENCES "public"."service_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_quote" ADD CONSTRAINT "service_order_quote_sent_by_user_id_user_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_quote" ADD CONSTRAINT "service_order_quote_approved_by_portal_user_id_user_id_fk" FOREIGN KEY ("approved_by_portal_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_quote" ADD CONSTRAINT "service_order_quote_approved_manually_by_user_id_user_id_fk" FOREIGN KEY ("approved_manually_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_quote" ADD CONSTRAINT "service_order_quote_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_quote_item" ADD CONSTRAINT "service_order_quote_item_quote_id_service_order_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."service_order_quote"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_settings" ADD CONSTRAINT "service_order_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_tag" ADD CONSTRAINT "service_order_tag_service_order_id_service_order_id_fk" FOREIGN KEY ("service_order_id") REFERENCES "public"."service_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_tag" ADD CONSTRAINT "service_order_tag_printed_by_user_id_user_id_fk" FOREIGN KEY ("printed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twoFactor" ADD CONSTRAINT "twoFactor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_interaction_org_idx" ON "account_interaction" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "account_interaction_occurred_idx" ON "account_interaction" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "account_task_org_id_idx" ON "account_task" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "account_task_status_idx" ON "account_task" USING btree ("status");--> statement-breakpoint
CREATE INDEX "account_task_owner_idx" ON "account_task" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "account_task_due_idx" ON "account_task" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "app_queue_job_status_available_idx" ON "app_queue_job" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "app_queue_job_locked_at_idx" ON "app_queue_job" USING btree ("locked_at");--> statement-breakpoint
CREATE INDEX "app_queue_job_type_idx" ON "app_queue_job" USING btree ("type");--> statement-breakpoint
CREATE INDEX "approval_request_org_idx" ON "approval_request" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "approval_request_status_idx" ON "approval_request" USING btree ("status");--> statement-breakpoint
CREATE INDEX "authorized_signatory_organization_id_idx" ON "authorized_signatory" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "authorized_signatory_user_id_idx" ON "authorized_signatory" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "authorized_signatory_asset_type_id_idx" ON "authorized_signatory" USING btree ("asset_type_id");--> statement-breakpoint
CREATE INDEX "authorized_signatory_status_idx" ON "authorized_signatory" USING btree ("status");--> statement-breakpoint
CREATE INDEX "authorized_signatory_expires_at_idx" ON "authorized_signatory" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "authorized_signatory_audit_log_signatory_id_idx" ON "authorized_signatory_audit_log" USING btree ("signatory_id");--> statement-breakpoint
CREATE INDEX "authorized_signatory_audit_log_performed_at_idx" ON "authorized_signatory_audit_log" USING btree ("performed_at");--> statement-breakpoint
CREATE INDEX "automatic_send_audit_org_idx" ON "automatic_send_audit_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "automatic_send_audit_so_idx" ON "automatic_send_audit_log" USING btree ("service_order_id");--> statement-breakpoint
CREATE INDEX "automatic_send_audit_created_idx" ON "automatic_send_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "automatic_send_rule_org_idx" ON "automatic_send_rule" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "automatic_send_rule_customer_idx" ON "automatic_send_rule" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "automatic_send_rule_agreement_idx" ON "automatic_send_rule" USING btree ("organization_id","commercial_agreement_id");--> statement-breakpoint
CREATE INDEX "automatic_send_rule_category_idx" ON "automatic_send_rule" USING btree ("organization_id","service_category");--> statement-breakpoint
CREATE INDEX "billing_group_org_idx" ON "billing_group" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "billing_group_customer_idx" ON "billing_group" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "billing_group_status_idx" ON "billing_group" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_group_service_order_uidx" ON "billing_group_service_order" USING btree ("group_id","service_order_id");--> statement-breakpoint
CREATE INDEX "billing_group_service_order_so_idx" ON "billing_group_service_order" USING btree ("service_order_id");--> statement-breakpoint
CREATE INDEX "calibration_visit_org_idx" ON "calibration_visit" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "calibration_visit_unit_idx" ON "calibration_visit" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "calibration_visit_customer_idx" ON "calibration_visit" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "calibration_visit_technician_idx" ON "calibration_visit" USING btree ("technician_id");--> statement-breakpoint
CREATE INDEX "calibration_visit_status_idx" ON "calibration_visit" USING btree ("status");--> statement-breakpoint
CREATE INDEX "calibration_visit_scheduled_idx" ON "calibration_visit" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "certificate_numbering_audit_org_idx" ON "certificate_numbering_audit_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "certificate_numbering_audit_profile_idx" ON "certificate_numbering_audit_log" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_numbering_profile_org_uidx" ON "certificate_numbering_profile" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_numbering_sequence_uidx" ON "certificate_numbering_sequence" USING btree ("organization_id","profile_id","sequence_key");--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_release_job_uidx" ON "certificate_release" USING btree ("calibration_job_id");--> statement-breakpoint
CREATE INDEX "certificate_release_org_idx" ON "certificate_release" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "certificate_release_status_idx" ON "certificate_release" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "certificate_release_policy_idx" ON "certificate_release" USING btree ("applied_policy_id");--> statement-breakpoint
CREATE INDEX "certificate_release_audit_org_idx" ON "certificate_release_audit_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "certificate_release_audit_release_idx" ON "certificate_release_audit_log" USING btree ("certificate_release_id");--> statement-breakpoint
CREATE INDEX "certificate_release_audit_created_idx" ON "certificate_release_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "certificate_release_policy_org_idx" ON "certificate_release_policy" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "certificate_release_policy_customer_idx" ON "certificate_release_policy" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "certificate_release_policy_agreement_idx" ON "certificate_release_policy" USING btree ("organization_id","commercial_agreement_id");--> statement-breakpoint
CREATE INDEX "certificate_release_policy_category_idx" ON "certificate_release_policy" USING btree ("organization_id","service_category");--> statement-breakpoint
CREATE INDEX "certificate_template_assignment_org_idx" ON "certificate_template_assignment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "certificate_template_assignment_template_idx" ON "certificate_template_assignment" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "certificate_template_assignment_version_idx" ON "certificate_template_assignment" USING btree ("template_version_id");--> statement-breakpoint
CREATE INDEX "certificate_template_assignment_unit_idx" ON "certificate_template_assignment" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "certificate_template_assignment_service_idx" ON "certificate_template_assignment" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "certificate_template_assignment_method_idx" ON "certificate_template_assignment" USING btree ("method_id");--> statement-breakpoint
CREATE INDEX "certificate_template_assignment_status_idx" ON "certificate_template_assignment" USING btree ("status");--> statement-breakpoint
CREATE INDEX "certificate_template_preview_org_idx" ON "certificate_template_preview" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "certificate_template_preview_version_idx" ON "certificate_template_preview" USING btree ("template_version_id");--> statement-breakpoint
CREATE INDEX "certificate_template_preview_status_idx" ON "certificate_template_preview" USING btree ("status");--> statement-breakpoint
CREATE INDEX "certificate_template_preview_expires_at_idx" ON "certificate_template_preview" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "certificate_template_version_org_idx" ON "certificate_template_version" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "certificate_template_version_template_idx" ON "certificate_template_version" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "certificate_template_version_status_idx" ON "certificate_template_version" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_template_version_template_version_uidx" ON "certificate_template_version" USING btree ("template_id","version");--> statement-breakpoint
CREATE INDEX "customer_group_auth_org_id_idx" ON "customer_group" USING btree ("auth_organization_id");--> statement-breakpoint
CREATE INDEX "customer_group_lab_org_id_idx" ON "customer_group" USING btree ("lab_organization_id");--> statement-breakpoint
CREATE INDEX "entitlement_override_org_idx" ON "entitlement_override" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "import_run_org_idx" ON "import_run" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "import_run_created_idx" ON "import_run" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_sync_cursor_integration_type_uidx" ON "integration_sync_cursor" USING btree ("integration_id","cursor_type");--> statement-breakpoint
CREATE INDEX "integration_sync_cursor_org_type_idx" ON "integration_sync_cursor" USING btree ("organization_id","cursor_type");--> statement-breakpoint
CREATE INDEX "integration_sync_cursor_last_poll_idx" ON "integration_sync_cursor" USING btree ("last_successful_poll_at");--> statement-breakpoint
CREATE INDEX "integration_sync_item_run_idx" ON "integration_sync_item" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "integration_sync_item_integration_target_status_idx" ON "integration_sync_item" USING btree ("integration_id","target","status");--> statement-breakpoint
CREATE INDEX "integration_sync_item_local_entity_idx" ON "integration_sync_item" USING btree ("integration_id","local_entity_id");--> statement-breakpoint
CREATE INDEX "integration_sync_item_request_fingerprint_idx" ON "integration_sync_item" USING btree ("integration_id","target","request_fingerprint");--> statement-breakpoint
CREATE INDEX "integration_sync_item_dead_letter_idx" ON "integration_sync_item" USING btree ("integration_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "issued_certificate_snapshot_org_idx" ON "issued_certificate_snapshot" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issued_certificate_snapshot_job_uidx" ON "issued_certificate_snapshot" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "issued_certificate_snapshot_template_idx" ON "issued_certificate_snapshot" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "issued_certificate_snapshot_version_idx" ON "issued_certificate_snapshot" USING btree ("template_version_id");--> statement-breakpoint
CREATE INDEX "issued_certificate_snapshot_status_idx" ON "issued_certificate_snapshot" USING btree ("status");--> statement-breakpoint
CREATE INDEX "lab_account_setup_token_user_idx" ON "lab_account_setup_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "lab_account_setup_token_org_idx" ON "lab_account_setup_token" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "lab_account_setup_token_invitation_idx" ON "lab_account_setup_token" USING btree ("invitation_id");--> statement-breakpoint
CREATE INDEX "lab_account_setup_token_expires_idx" ON "lab_account_setup_token" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "lab_account_setup_token_consumed_idx" ON "lab_account_setup_token" USING btree ("consumed_at");--> statement-breakpoint
CREATE INDEX "mass_composition_profile_org_idx" ON "mass_composition_profile" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "mass_composition_profile_class_idx" ON "mass_composition_profile" USING btree ("organization_id","profile_class");--> statement-breakpoint
CREATE UNIQUE INDEX "mass_composition_profile_org_class_nominal_uidx" ON "mass_composition_profile" USING btree ("organization_id","profile_class","nominal_g");--> statement-breakpoint
CREATE INDEX "operator_alert_status_idx" ON "operator_alert" USING btree ("status");--> statement-breakpoint
CREATE INDEX "operator_alert_org_idx" ON "operator_alert" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "passkey_user_id_idx" ON "passkey" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "passkey_credential_id_uidx" ON "passkey" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "standard_certificate_document_standard_idx" ON "reference_standard_certificate_document" USING btree ("standard_id");--> statement-breakpoint
CREATE INDEX "standard_certificate_document_org_idx" ON "reference_standard_certificate_document" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "standard_certificate_document_unit_idx" ON "reference_standard_certificate_document" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "standard_certificate_document_current_idx" ON "reference_standard_certificate_document" USING btree ("standard_id","is_current");--> statement-breakpoint
CREATE UNIQUE INDEX "service_order_org_number_uidx" ON "service_order" USING btree ("organization_id","service_order_number");--> statement-breakpoint
CREATE INDEX "service_order_org_status_opened_idx" ON "service_order" USING btree ("organization_id","status","opened_at");--> statement-breakpoint
CREATE INDEX "service_order_unit_status_idx" ON "service_order" USING btree ("unit_id","status");--> statement-breakpoint
CREATE INDEX "service_order_customer_idx" ON "service_order" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "service_order_asset_idx" ON "service_order" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "service_order_technician_idx" ON "service_order" USING btree ("responsible_technician_id");--> statement-breakpoint
CREATE INDEX "service_order_source_idx" ON "service_order" USING btree ("source_service_order_id");--> statement-breakpoint
CREATE INDEX "service_order_billing_document_idx" ON "service_order" USING btree ("billing_document_id");--> statement-breakpoint
CREATE INDEX "service_order_asset_snapshot_asset_idx" ON "service_order_asset_snapshot" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "service_order_attachment_order_idx" ON "service_order_attachment" USING btree ("service_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_order_certificate_link_uidx" ON "service_order_certificate_link" USING btree ("service_order_id","certificate_job_id");--> statement-breakpoint
CREATE INDEX "service_order_certificate_link_job_idx" ON "service_order_certificate_link" USING btree ("certificate_job_id");--> statement-breakpoint
CREATE INDEX "service_order_delivery_document_order_idx" ON "service_order_delivery_document" USING btree ("service_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_order_delivery_document_number_version_uidx" ON "service_order_delivery_document" USING btree ("document_number","version");--> statement-breakpoint
CREATE INDEX "service_order_email_log_so_idx" ON "service_order_email_log" USING btree ("service_order_id");--> statement-breakpoint
CREATE INDEX "service_order_evaluation_order_idx" ON "service_order_evaluation" USING btree ("service_order_id");--> statement-breakpoint
CREATE INDEX "service_order_evaluation_technician_idx" ON "service_order_evaluation" USING btree ("technician_id");--> statement-breakpoint
CREATE INDEX "service_order_event_order_created_idx" ON "service_order_event_log" USING btree ("service_order_id","created_at");--> statement-breakpoint
CREATE INDEX "service_order_event_org_unit_created_idx" ON "service_order_event_log" USING btree ("organization_id","unit_id","created_at");--> statement-breakpoint
CREATE INDEX "service_order_event_type_idx" ON "service_order_event_log" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "service_order_execution_order_idx" ON "service_order_execution" USING btree ("service_order_id");--> statement-breakpoint
CREATE INDEX "service_order_execution_item_execution_idx" ON "service_order_execution_item" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "service_order_execution_item_quote_item_idx" ON "service_order_execution_item" USING btree ("quote_item_id");--> statement-breakpoint
CREATE INDEX "service_order_intake_document_order_idx" ON "service_order_intake_document" USING btree ("service_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_order_intake_document_number_version_uidx" ON "service_order_intake_document" USING btree ("document_number","version");--> statement-breakpoint
CREATE INDEX "service_order_outsourced_cost_org_idx" ON "service_order_outsourced_cost" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "service_order_outsourced_cost_so_idx" ON "service_order_outsourced_cost" USING btree ("service_order_id");--> statement-breakpoint
CREATE INDEX "service_order_outsourced_cost_payable_idx" ON "service_order_outsourced_cost" USING btree ("payable_link_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_order_public_access_token_hash_uidx" ON "service_order_public_access_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "service_order_public_access_token_order_idx" ON "service_order_public_access_token" USING btree ("service_order_id");--> statement-breakpoint
CREATE INDEX "service_order_public_access_token_quote_idx" ON "service_order_public_access_token" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "service_order_quote_order_status_idx" ON "service_order_quote" USING btree ("service_order_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "service_order_quote_order_version_uidx" ON "service_order_quote" USING btree ("service_order_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "service_order_quote_number_version_uidx" ON "service_order_quote" USING btree ("quote_number","version");--> statement-breakpoint
CREATE INDEX "service_order_quote_token_idx" ON "service_order_quote" USING btree ("portal_access_token_hash");--> statement-breakpoint
CREATE INDEX "service_order_quote_item_quote_idx" ON "service_order_quote_item" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_order_settings_org_uidx" ON "service_order_settings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "service_order_tag_order_idx" ON "service_order_tag" USING btree ("service_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_order_tag_number_uidx" ON "service_order_tag" USING btree ("tag_number");--> statement-breakpoint
CREATE INDEX "supplier_org_idx" ON "supplier" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "supplier_org_name_idx" ON "supplier" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "two_factor_user_id_idx" ON "twoFactor" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "calibration_job" ADD CONSTRAINT "calibration_job_visit_id_calibration_visit_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."calibration_visit"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_group_id_customer_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."customer_group"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_object_link" ADD CONSTRAINT "integration_object_link_drift_ack_user_fk" FOREIGN KEY ("drift_acknowledged_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_account_uidx" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "billing_document_item_service_order_idx" ON "billing_document_item" USING btree ("service_order_id");--> statement-breakpoint
CREATE INDEX "customer_group_id_idx" ON "customer" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "integration_object_link_drift_ack_idx" ON "integration_object_link" USING btree ("organization_id","drift_acknowledged_at");--> statement-breakpoint
CREATE UNIQUE INDEX "member_organization_user_uidx" ON "member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "session_expires_at_idx" ON "session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "verification_expires_at_idx" ON "verification" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "certificate_template" DROP COLUMN "config";--> statement-breakpoint
ALTER TABLE "billing_document" ADD CONSTRAINT "billing_document_public_id_unique" UNIQUE("public_id");