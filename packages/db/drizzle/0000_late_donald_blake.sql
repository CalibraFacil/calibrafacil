CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset" (
	"id" serial PRIMARY KEY NOT NULL,
	"unit_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"asset_type_id" integer NOT NULL,
	"specifications" jsonb,
	"name" text NOT NULL,
	"manufacturer" text,
	"model" text,
	"serial_number" text NOT NULL,
	"tag" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"last_calibration_date" timestamp,
	"next_calibration_date" timestamp,
	"comments" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "asset_tag_unique" UNIQUE("tag")
);
--> statement-breakpoint
CREATE TABLE "asset_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "asset_type" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"definition" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "asset_type_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "billing_contact" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"role" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_customer" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text DEFAULT 'ASAAS' NOT NULL,
	"provider_customer_id" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"tax_id" text,
	"address_snapshot" jsonb,
	"provider_snapshot" jsonb,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_customer_provider_customer_id_unique" UNIQUE("provider_customer_id")
);
--> statement-breakpoint
CREATE TABLE "calibration_job" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"unit_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"service_id" integer NOT NULL,
	"technician_id" text,
	"method_snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"due_date" timestamp,
	"performed_at" timestamp,
	"data" jsonb,
	"results" jsonb,
	"standards_snapshot" jsonb,
	"environmental_snapshot" jsonb,
	"certificate_template_id" integer,
	"certificate_template_snapshot" jsonb,
	"certificate_url" text,
	"label_url" text,
	"verification_token" text DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"approved_by" text,
	"approved_at" timestamp,
	"rejected_by" text,
	"rejected_at" timestamp,
	"rejection_reason" text,
	"supersedes_id" integer,
	"superseded_by_id" integer,
	"amendment_number" integer,
	"amendment_reason" text,
	"superseded_at" timestamp,
	"signature_metadata" jsonb,
	CONSTRAINT "calibration_job_verification_token_unique" UNIQUE("verification_token")
);
--> statement-breakpoint
CREATE TABLE "calibration_method" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"asset_type_id" integer,
	"name" text NOT NULL,
	"description" text,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"data_fields" jsonb NOT NULL,
	"formulas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"validations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"uncertainty_params" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parent_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"technical_reviewed_by" text,
	"published_at" timestamp,
	"published_by" text,
	"approved_by" text,
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "calibration_request" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"unit_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"auth_organization_id" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"observations" text,
	"internal_notes" text,
	"requested_due_date" timestamp with time zone,
	"submitted_by" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"rejected_by" text,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"converted_by" text,
	"converted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calibration_request_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "calibration_request_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"converted_job_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificate_template" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"config" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commercial_deal" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"primary_billing_contact_id" integer,
	"created_by" text,
	"closed_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commercial_offer" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"provider" text DEFAULT 'ASAAS' NOT NULL,
	"provider_mode" text NOT NULL,
	"activation_behavior" text DEFAULT 'NONE' NOT NULL,
	"base_plan_id" text,
	"billing_cycle" text,
	"contract_term_months" integer,
	"renewal_mode" text DEFAULT 'NONE' NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"subtotal_amount" integer NOT NULL,
	"discount_amount" integer DEFAULT 0 NOT NULL,
	"total_amount" integer NOT NULL,
	"due_date" timestamp,
	"offer_expires_at" timestamp,
	"payment_methods" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"customer_visible_description" text,
	"internal_notes" text,
	"terms_snapshot" jsonb NOT NULL,
	"customer_snapshot" jsonb NOT NULL,
	"provider_request_snapshot" jsonb,
	"provider_response_snapshot" jsonb,
	"checkout_url" text,
	"provider_checkout_id" text,
	"provider_payment_id" text,
	"provider_subscription_id" text,
	"billing_customer_id" integer NOT NULL,
	"issued_at" timestamp,
	"paid_at" timestamp,
	"activated_at" timestamp,
	"canceled_at" timestamp,
	"created_by" text,
	"canceled_by" text,
	"reissued_from_offer_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commercial_offer_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"type" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_amount" integer NOT NULL,
	"total_amount" integer NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commercial_offer_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"source" text NOT NULL,
	"source_event_id" text,
	"payload" jsonb,
	"changed_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corrective_action" (
	"id" serial PRIMARY KEY NOT NULL,
	"capa_number" text NOT NULL,
	"organization_id" text NOT NULL,
	"source" text DEFAULT 'nc_detection' NOT NULL,
	"source_reference" text,
	"title" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"detection_date" timestamp,
	"type" text DEFAULT 'corrective' NOT NULL,
	"severity" text DEFAULT 'minor' NOT NULL,
	"category" text DEFAULT 'procedure' NOT NULL,
	"root_cause_analysis" text,
	"rca_method" text,
	"action_plan" text,
	"preventive_measures" text,
	"responsible_id" text,
	"due_date" timestamp,
	"implementation_evidence" text,
	"implemented_at" timestamp,
	"investigation_completed_at" timestamp,
	"verified_at" timestamp,
	"verified_by" text,
	"verification_notes" text,
	"effectiveness_confirmed" boolean,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"closed_at" timestamp,
	"closed_by" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "corrective_action_capa_number_unique" UNIQUE("capa_number")
);
--> statement-breakpoint
CREATE TABLE "corrective_action_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"capa_id" integer NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "customer" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tax_id" text,
	"email" text,
	"phone" text,
	"address" jsonb,
	"auth_organization_id" text NOT NULL,
	"lab_organization_id" text NOT NULL,
	"compliance" jsonb,
	"internal_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" serial NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "environmental_limits" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"unit_id" integer NOT NULL,
	"asset_type_id" integer,
	"temperature_min" real,
	"temperature_max" real,
	"humidity_min" real,
	"humidity_max" real,
	"pressure_min" real,
	"pressure_max" real,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "env_limits_org_unit_asset_type_uidx" UNIQUE NULLS NOT DISTINCT("organization_id","unit_id","asset_type_id")
);
--> statement-breakpoint
CREATE TABLE "integration_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"integration_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"credential_type" text DEFAULT 'bearer' NOT NULL,
	"config" jsonb NOT NULL,
	"encrypted_secret" text NOT NULL,
	"secret_iv" text NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_event_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"integration_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"run_id" text,
	"level" text DEFAULT 'info' NOT NULL,
	"event" text NOT NULL,
	"message" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_object_link" (
	"id" text PRIMARY KEY NOT NULL,
	"integration_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"target" text NOT NULL,
	"local_entity_id" text NOT NULL,
	"remote_entity_id" text,
	"remote_display_id" text,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_sync_run" (
	"id" text PRIMARY KEY NOT NULL,
	"integration_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"trigger" text NOT NULL,
	"target" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"initiated_by" text,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"summary" jsonb,
	"error_summary" text,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_unit_assignment" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"unit_id" integer NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "member_unit_assignment_member_unit_unique" UNIQUE("member_id","unit_id")
);
--> statement-breakpoint
CREATE TABLE "member_visual_signature" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"r2_key" text NOT NULL,
	"content_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"file_size" integer NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "method_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"method_id" integer NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "non_conformance" (
	"id" serial PRIMARY KEY NOT NULL,
	"nc_number" text NOT NULL,
	"organization_id" text NOT NULL,
	"job_id" integer,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"detected_by" text NOT NULL,
	"detected_at" timestamp NOT NULL,
	"disposition" text,
	"disposition_justification" text,
	"disposition_approved_by" text,
	"disposition_approved_at" timestamp,
	"correction_taken" text,
	"resolved_at" timestamp,
	"resolved_by" text,
	"status" text DEFAULT 'open' NOT NULL,
	"capa_id" integer,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "non_conformance_nc_number_unique" UNIQUE("nc_number")
);
--> statement-breakpoint
CREATE TABLE "non_conformance_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"nc_id" integer NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipient_user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"priority" text DEFAULT 'MEDIUM' NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"related_entity" jsonb,
	"action_url" text,
	"channels_sent" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'UNREAD' NOT NULL,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"preferences" jsonb NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"notify_self_actions" boolean DEFAULT false NOT NULL,
	"digest_frequency" text DEFAULT 'NONE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preference_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	"type" text DEFAULT 'LAB',
	"cnpj" text,
	"accreditation_number" text,
	"accreditation_body" text,
	"street" text,
	"number" text,
	"complement" text,
	"neighbourhood" text,
	"city" text,
	"state" text,
	"cep" text,
	"phone" text,
	"email" text,
	"website" text,
	"technical_manager_name" text,
	"technical_manager_title" text,
	"asaas_customer_id" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "organization_api_key" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_used_at" timestamp,
	"last_used_ip" text,
	"created_by" text NOT NULL,
	"revoked_at" timestamp,
	"revoked_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_api_key_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "organization_api_key_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"api_key_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"action" text NOT NULL,
	"performed_by" text,
	"ip_address" text,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_custom_domain" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"hostname" text NOT NULL,
	"verification_token" text NOT NULL,
	"verified_at" timestamp,
	"activated_at" timestamp,
	"last_verified_at" timestamp,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_custom_domain_hostname_unique" UNIQUE("hostname")
);
--> statement-breakpoint
CREATE TABLE "organization_event_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"unit_id" integer,
	"actor_user_id" text,
	"actor_member_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_integration" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text,
	"last_validated_at" timestamp,
	"last_validation_error" text,
	"disabled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_signing_certificate" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"unit_id" integer NOT NULL,
	"name" text NOT NULL,
	"serial_number" text NOT NULL,
	"issuer_cn" text NOT NULL,
	"subject_cn" text NOT NULL,
	"subject_cpf_cnpj" text,
	"valid_from" timestamp NOT NULL,
	"valid_until" timestamp NOT NULL,
	"encrypted_p12" text NOT NULL,
	"encrypted_password" text NOT NULL,
	"password_iv" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	"revoked_by" text,
	"revoked_reason" text
);
--> statement-breakpoint
CREATE TABLE "organization_success_profile" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"account_owner_user_id" text,
	"account_owner_name" text,
	"account_owner_email" text,
	"support_contact_email" text,
	"internal_owner_user_id" text,
	"priority_support" boolean DEFAULT false NOT NULL,
	"sla_tier" text DEFAULT 'PLAN_DEFAULT' NOT NULL,
	"onboarding_status" text DEFAULT 'NOT_STARTED' NOT NULL,
	"migration_status" text DEFAULT 'NOT_REQUIRED' NOT NULL,
	"go_live_status" text DEFAULT 'NOT_SCHEDULED' NOT NULL,
	"health_status" text DEFAULT 'HEALTHY' NOT NULL,
	"blockers" jsonb,
	"next_action" text,
	"next_action_due_at" timestamp,
	"next_action_completed_at" timestamp,
	"go_live_target_date" timestamp,
	"go_live_actual_date" timestamp,
	"public_status_note" text,
	"internal_notes" text,
	"last_touched_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_support_request" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"assigned_to_user_id" text,
	"category" text NOT NULL,
	"priority" text DEFAULT 'NORMAL' NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"subject" text NOT NULL,
	"description" text NOT NULL,
	"public_response" text,
	"sla_target_at" timestamp,
	"first_response_at" timestamp,
	"escalated_at" timestamp,
	"escalated_by_user_id" text,
	"escalation_reason" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_support_request_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"support_request_id" integer NOT NULL,
	"organization_id" text NOT NULL,
	"actor_user_id" text,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"public_visible" boolean DEFAULT false NOT NULL,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_unit" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_record" (
	"id" serial PRIMARY KEY NOT NULL,
	"commercial_offer_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text DEFAULT 'ASAAS' NOT NULL,
	"provider_checkout_id" text,
	"provider_payment_id" text,
	"provider_subscription_id" text,
	"external_reference" text,
	"amount" integer NOT NULL,
	"net_amount" integer,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"payment_method" text NOT NULL,
	"status" text NOT NULL,
	"card_last4" text,
	"card_brand" text,
	"due_date" timestamp,
	"paid_at" timestamp,
	"invoice_url" text,
	"bank_slip_url" text,
	"pix_qr_code_url" text,
	"pix_payload" text,
	"provider_snapshot" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_record_id" integer NOT NULL,
	"commercial_offer_id" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"source_event_id" text,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personnel_competence" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"asset_type_id" integer,
	"scope_description" text NOT NULL,
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"qualified_at" timestamp,
	"expires_at" timestamp,
	"certificate_r2_key" text,
	"certificate_file_name" text,
	"notes" text,
	"requested_by" text NOT NULL,
	"evaluated_by" text,
	"approved_by" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "competence_org_user_asset_type_uidx" UNIQUE NULLS NOT DISTINCT("organization_id","user_id","asset_type_id")
);
--> statement-breakpoint
CREATE TABLE "personnel_competence_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"competence_id" integer NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "platform_event_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"target_user_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_webhook_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'ASAAS' NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp,
	"processing_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "provider_webhook_event_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "public_api_idempotency_key" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"api_key_id" text NOT NULL,
	"request_method" text NOT NULL,
	"request_path" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "public_api_resource_ref" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"external_id" text NOT NULL,
	"created_by_api_key_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_api_webhook_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"request_url" text NOT NULL,
	"request_body" jsonb NOT NULL,
	"response_status" integer,
	"response_body" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"delivered_at" timestamp,
	"failed_at" timestamp,
	"last_error" text,
	"replay_of_delivery_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_api_webhook_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"target_url" text NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"secret_prefix" text NOT NULL,
	"encrypted_secret" text NOT NULL,
	"secret_iv" text NOT NULL,
	"last_success_at" timestamp,
	"last_failure_at" timestamp,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reference_standard" (
	"id" serial PRIMARY KEY NOT NULL,
	"unit_id" integer NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text,
	"serial_number" text NOT NULL,
	"manufacturer" text,
	"model" text,
	"certificate_number" text NOT NULL,
	"calibrated_by" text,
	"calibration_date" timestamp NOT NULL,
	"next_calibration_date" timestamp NOT NULL,
	"reference_value" real,
	"uncertainty" real,
	"uncertainty_unit" text,
	"coverage_factor" real DEFAULT 2 NOT NULL,
	"distribution" text DEFAULT 'normal' NOT NULL,
	"drift" real,
	"certified_values" jsonb,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "reference_standard_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"standard_id" integer NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "scheduled_notification" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"scheduled_for" timestamp NOT NULL,
	"lead_time_days" integer DEFAULT 7 NOT NULL,
	"sent_at" timestamp,
	"canceled" boolean DEFAULT false NOT NULL,
	"canceled_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service" (
	"id" serial PRIMARY KEY NOT NULL,
	"unit_id" integer NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"method_id" integer,
	"asset_type_id" integer,
	"price" integer,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"tat" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_id" integer NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	"impersonated_by" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "sso_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"oidc_config" text,
	"saml_config" text,
	"user_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"domain" text NOT NULL,
	"domain_verified" boolean DEFAULT false,
	CONSTRAINT "sso_provider_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" text DEFAULT 'TRIAL' NOT NULL,
	"billing_cycle" text,
	"renewal_mode" text DEFAULT 'NONE' NOT NULL,
	"contract_term_months" integer,
	"source_commercial_offer_id" text,
	"provider_subscription_id" text,
	"current_period_start" timestamp,
	"current_period_end" timestamp,
	"next_billing_date" timestamp,
	"canceled_at" timestamp,
	"cancel_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_organization_id_unique" UNIQUE("organization_id"),
	CONSTRAINT "subscription_provider_subscription_id_unique" UNIQUE("provider_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "training_record" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"competence_id" integer,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"provider" text,
	"description" text,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp,
	"hours_completed" integer,
	"certificate_r2_key" text,
	"certificate_file_name" text,
	"score" real,
	"passing_score" real,
	"passed" boolean,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "training_record_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"training_record_id" integer NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" text DEFAULT 'user' NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"ban_reason" text,
	"ban_expires" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_unit_id_organization_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_asset_type_id_asset_type_id_fk" FOREIGN KEY ("asset_type_id") REFERENCES "public"."asset_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_audit_log" ADD CONSTRAINT "asset_audit_log_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_audit_log" ADD CONSTRAINT "asset_audit_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_contact" ADD CONSTRAINT "billing_contact_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_contact" ADD CONSTRAINT "billing_contact_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_customer" ADD CONSTRAINT "billing_customer_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_customer" ADD CONSTRAINT "billing_customer_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD CONSTRAINT "calibration_job_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD CONSTRAINT "calibration_job_unit_id_organization_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD CONSTRAINT "calibration_job_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD CONSTRAINT "calibration_job_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD CONSTRAINT "calibration_job_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD CONSTRAINT "calibration_job_technician_id_user_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD CONSTRAINT "calibration_job_certificate_template_id_certificate_template_id_fk" FOREIGN KEY ("certificate_template_id") REFERENCES "public"."certificate_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD CONSTRAINT "calibration_job_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD CONSTRAINT "calibration_job_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD CONSTRAINT "calibration_job_rejected_by_user_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_method" ADD CONSTRAINT "calibration_method_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_method" ADD CONSTRAINT "calibration_method_asset_type_id_asset_type_id_fk" FOREIGN KEY ("asset_type_id") REFERENCES "public"."asset_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_method" ADD CONSTRAINT "calibration_method_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_method" ADD CONSTRAINT "calibration_method_technical_reviewed_by_user_id_fk" FOREIGN KEY ("technical_reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_method" ADD CONSTRAINT "calibration_method_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_method" ADD CONSTRAINT "calibration_method_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_request" ADD CONSTRAINT "calibration_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_request" ADD CONSTRAINT "calibration_request_unit_id_organization_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_request" ADD CONSTRAINT "calibration_request_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_request" ADD CONSTRAINT "calibration_request_auth_organization_id_organization_id_fk" FOREIGN KEY ("auth_organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_request" ADD CONSTRAINT "calibration_request_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_request" ADD CONSTRAINT "calibration_request_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_request" ADD CONSTRAINT "calibration_request_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_request" ADD CONSTRAINT "calibration_request_rejected_by_user_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_request" ADD CONSTRAINT "calibration_request_converted_by_user_id_fk" FOREIGN KEY ("converted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_request_audit_log" ADD CONSTRAINT "calibration_request_audit_log_request_id_calibration_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."calibration_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_request_audit_log" ADD CONSTRAINT "calibration_request_audit_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_request_item" ADD CONSTRAINT "calibration_request_item_request_id_calibration_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."calibration_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_request_item" ADD CONSTRAINT "calibration_request_item_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_request_item" ADD CONSTRAINT "calibration_request_item_converted_job_id_calibration_job_id_fk" FOREIGN KEY ("converted_job_id") REFERENCES "public"."calibration_job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_template" ADD CONSTRAINT "certificate_template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_template" ADD CONSTRAINT "certificate_template_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_deal" ADD CONSTRAINT "commercial_deal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_deal" ADD CONSTRAINT "commercial_deal_primary_billing_contact_id_billing_contact_id_fk" FOREIGN KEY ("primary_billing_contact_id") REFERENCES "public"."billing_contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_deal" ADD CONSTRAINT "commercial_deal_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_deal" ADD CONSTRAINT "commercial_deal_closed_by_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_offer" ADD CONSTRAINT "commercial_offer_deal_id_commercial_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."commercial_deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_offer" ADD CONSTRAINT "commercial_offer_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_offer" ADD CONSTRAINT "commercial_offer_billing_customer_id_billing_customer_id_fk" FOREIGN KEY ("billing_customer_id") REFERENCES "public"."billing_customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_offer" ADD CONSTRAINT "commercial_offer_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_offer" ADD CONSTRAINT "commercial_offer_canceled_by_user_id_fk" FOREIGN KEY ("canceled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_offer_item" ADD CONSTRAINT "commercial_offer_item_offer_id_commercial_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."commercial_offer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_offer_status_history" ADD CONSTRAINT "commercial_offer_status_history_offer_id_commercial_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."commercial_offer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_offer_status_history" ADD CONSTRAINT "commercial_offer_status_history_changed_by_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_action" ADD CONSTRAINT "corrective_action_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_action" ADD CONSTRAINT "corrective_action_responsible_id_user_id_fk" FOREIGN KEY ("responsible_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_action" ADD CONSTRAINT "corrective_action_verified_by_user_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_action" ADD CONSTRAINT "corrective_action_closed_by_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_action" ADD CONSTRAINT "corrective_action_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_action_audit_log" ADD CONSTRAINT "corrective_action_audit_log_capa_id_corrective_action_id_fk" FOREIGN KEY ("capa_id") REFERENCES "public"."corrective_action"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_action_audit_log" ADD CONSTRAINT "corrective_action_audit_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_auth_organization_id_organization_id_fk" FOREIGN KEY ("auth_organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_lab_organization_id_organization_id_fk" FOREIGN KEY ("lab_organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_audit_log" ADD CONSTRAINT "customer_audit_log_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_audit_log" ADD CONSTRAINT "customer_audit_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environmental_limits" ADD CONSTRAINT "environmental_limits_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environmental_limits" ADD CONSTRAINT "environmental_limits_unit_id_organization_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environmental_limits" ADD CONSTRAINT "environmental_limits_asset_type_id_asset_type_id_fk" FOREIGN KEY ("asset_type_id") REFERENCES "public"."asset_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environmental_limits" ADD CONSTRAINT "environmental_limits_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connection" ADD CONSTRAINT "integration_connection_integration_id_organization_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."organization_integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connection" ADD CONSTRAINT "integration_connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connection" ADD CONSTRAINT "integration_connection_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connection" ADD CONSTRAINT "integration_connection_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connection" ADD CONSTRAINT "integration_connection_integration_org_fk" FOREIGN KEY ("integration_id","organization_id") REFERENCES "public"."organization_integration"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_event_log" ADD CONSTRAINT "integration_event_log_integration_id_organization_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."organization_integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_event_log" ADD CONSTRAINT "integration_event_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_event_log" ADD CONSTRAINT "integration_event_log_run_id_integration_sync_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."integration_sync_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_event_log" ADD CONSTRAINT "integration_event_log_integration_org_fk" FOREIGN KEY ("integration_id","organization_id") REFERENCES "public"."organization_integration"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_object_link" ADD CONSTRAINT "integration_object_link_integration_id_organization_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."organization_integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_object_link" ADD CONSTRAINT "integration_object_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_object_link" ADD CONSTRAINT "integration_object_link_integration_org_fk" FOREIGN KEY ("integration_id","organization_id") REFERENCES "public"."organization_integration"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_run" ADD CONSTRAINT "integration_sync_run_integration_id_organization_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."organization_integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_run" ADD CONSTRAINT "integration_sync_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_run" ADD CONSTRAINT "integration_sync_run_initiated_by_user_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_run" ADD CONSTRAINT "integration_sync_run_integration_org_fk" FOREIGN KEY ("integration_id","organization_id") REFERENCES "public"."organization_integration"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_audit_log" ADD CONSTRAINT "job_audit_log_job_id_calibration_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."calibration_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_audit_log" ADD CONSTRAINT "job_audit_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_unit_assignment" ADD CONSTRAINT "member_unit_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_unit_assignment" ADD CONSTRAINT "member_unit_assignment_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_unit_assignment" ADD CONSTRAINT "member_unit_assignment_unit_id_organization_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_unit_assignment" ADD CONSTRAINT "member_unit_assignment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_visual_signature" ADD CONSTRAINT "member_visual_signature_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_visual_signature" ADD CONSTRAINT "member_visual_signature_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "method_audit_log" ADD CONSTRAINT "method_audit_log_method_id_calibration_method_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."calibration_method"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "method_audit_log" ADD CONSTRAINT "method_audit_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "non_conformance" ADD CONSTRAINT "non_conformance_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "non_conformance" ADD CONSTRAINT "non_conformance_job_id_calibration_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."calibration_job"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "non_conformance" ADD CONSTRAINT "non_conformance_detected_by_user_id_fk" FOREIGN KEY ("detected_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "non_conformance" ADD CONSTRAINT "non_conformance_disposition_approved_by_user_id_fk" FOREIGN KEY ("disposition_approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "non_conformance" ADD CONSTRAINT "non_conformance_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "non_conformance" ADD CONSTRAINT "non_conformance_capa_id_corrective_action_id_fk" FOREIGN KEY ("capa_id") REFERENCES "public"."corrective_action"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "non_conformance" ADD CONSTRAINT "non_conformance_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "non_conformance_audit_log" ADD CONSTRAINT "non_conformance_audit_log_nc_id_non_conformance_id_fk" FOREIGN KEY ("nc_id") REFERENCES "public"."non_conformance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "non_conformance_audit_log" ADD CONSTRAINT "non_conformance_audit_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_api_key" ADD CONSTRAINT "organization_api_key_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_api_key" ADD CONSTRAINT "organization_api_key_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_api_key" ADD CONSTRAINT "organization_api_key_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_api_key_audit_log" ADD CONSTRAINT "organization_api_key_audit_log_api_key_id_organization_api_key_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."organization_api_key"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_api_key_audit_log" ADD CONSTRAINT "organization_api_key_audit_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_api_key_audit_log" ADD CONSTRAINT "organization_api_key_audit_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_custom_domain" ADD CONSTRAINT "organization_custom_domain_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_custom_domain" ADD CONSTRAINT "organization_custom_domain_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_event_log" ADD CONSTRAINT "organization_event_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_event_log" ADD CONSTRAINT "organization_event_log_unit_id_organization_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_event_log" ADD CONSTRAINT "organization_event_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_event_log" ADD CONSTRAINT "organization_event_log_actor_member_id_member_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_integration" ADD CONSTRAINT "organization_integration_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_integration" ADD CONSTRAINT "organization_integration_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_integration" ADD CONSTRAINT "organization_integration_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_signing_certificate" ADD CONSTRAINT "organization_signing_certificate_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_signing_certificate" ADD CONSTRAINT "organization_signing_certificate_unit_id_organization_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_signing_certificate" ADD CONSTRAINT "organization_signing_certificate_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_signing_certificate" ADD CONSTRAINT "organization_signing_certificate_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_success_profile" ADD CONSTRAINT "organization_success_profile_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_success_profile" ADD CONSTRAINT "organization_success_profile_account_owner_user_id_user_id_fk" FOREIGN KEY ("account_owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_success_profile" ADD CONSTRAINT "organization_success_profile_internal_owner_user_id_user_id_fk" FOREIGN KEY ("internal_owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_support_request" ADD CONSTRAINT "organization_support_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_support_request" ADD CONSTRAINT "organization_support_request_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_support_request" ADD CONSTRAINT "organization_support_request_assigned_to_user_id_user_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_support_request" ADD CONSTRAINT "organization_support_request_escalated_by_user_id_user_id_fk" FOREIGN KEY ("escalated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_support_request_event" ADD CONSTRAINT "organization_support_request_event_support_request_id_organization_support_request_id_fk" FOREIGN KEY ("support_request_id") REFERENCES "public"."organization_support_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_support_request_event" ADD CONSTRAINT "organization_support_request_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_support_request_event" ADD CONSTRAINT "organization_support_request_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_unit" ADD CONSTRAINT "organization_unit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_unit" ADD CONSTRAINT "organization_unit_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_record" ADD CONSTRAINT "payment_record_commercial_offer_id_commercial_offer_id_fk" FOREIGN KEY ("commercial_offer_id") REFERENCES "public"."commercial_offer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_record" ADD CONSTRAINT "payment_record_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_status_history" ADD CONSTRAINT "payment_status_history_payment_record_id_payment_record_id_fk" FOREIGN KEY ("payment_record_id") REFERENCES "public"."payment_record"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_status_history" ADD CONSTRAINT "payment_status_history_commercial_offer_id_commercial_offer_id_fk" FOREIGN KEY ("commercial_offer_id") REFERENCES "public"."commercial_offer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_competence" ADD CONSTRAINT "personnel_competence_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_competence" ADD CONSTRAINT "personnel_competence_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_competence" ADD CONSTRAINT "personnel_competence_asset_type_id_asset_type_id_fk" FOREIGN KEY ("asset_type_id") REFERENCES "public"."asset_type"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_competence" ADD CONSTRAINT "personnel_competence_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_competence" ADD CONSTRAINT "personnel_competence_evaluated_by_user_id_fk" FOREIGN KEY ("evaluated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_competence" ADD CONSTRAINT "personnel_competence_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_competence" ADD CONSTRAINT "personnel_competence_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_competence_audit_log" ADD CONSTRAINT "personnel_competence_audit_log_competence_id_personnel_competence_id_fk" FOREIGN KEY ("competence_id") REFERENCES "public"."personnel_competence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_event_log" ADD CONSTRAINT "platform_event_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_event_log" ADD CONSTRAINT "platform_event_log_target_user_id_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_api_idempotency_key" ADD CONSTRAINT "public_api_idempotency_key_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_api_idempotency_key" ADD CONSTRAINT "public_api_idempotency_key_api_key_id_organization_api_key_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."organization_api_key"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_api_resource_ref" ADD CONSTRAINT "public_api_resource_ref_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_api_resource_ref" ADD CONSTRAINT "public_api_resource_ref_created_by_api_key_id_organization_api_key_id_fk" FOREIGN KEY ("created_by_api_key_id") REFERENCES "public"."organization_api_key"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_api_webhook_delivery" ADD CONSTRAINT "public_api_webhook_delivery_subscription_id_public_api_webhook_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."public_api_webhook_subscription"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_api_webhook_delivery" ADD CONSTRAINT "public_api_webhook_delivery_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_api_webhook_subscription" ADD CONSTRAINT "public_api_webhook_subscription_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_api_webhook_subscription" ADD CONSTRAINT "public_api_webhook_subscription_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_api_webhook_subscription" ADD CONSTRAINT "public_api_webhook_subscription_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_standard" ADD CONSTRAINT "reference_standard_unit_id_organization_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_standard" ADD CONSTRAINT "reference_standard_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_standard" ADD CONSTRAINT "reference_standard_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_standard_audit_log" ADD CONSTRAINT "reference_standard_audit_log_standard_id_reference_standard_id_fk" FOREIGN KEY ("standard_id") REFERENCES "public"."reference_standard"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_standard_audit_log" ADD CONSTRAINT "reference_standard_audit_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_notification" ADD CONSTRAINT "scheduled_notification_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service" ADD CONSTRAINT "service_unit_id_organization_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service" ADD CONSTRAINT "service_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service" ADD CONSTRAINT "service_method_id_calibration_method_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."calibration_method"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service" ADD CONSTRAINT "service_asset_type_id_asset_type_id_fk" FOREIGN KEY ("asset_type_id") REFERENCES "public"."asset_type"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_audit_log" ADD CONSTRAINT "service_audit_log_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_audit_log" ADD CONSTRAINT "service_audit_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_impersonated_by_user_id_fk" FOREIGN KEY ("impersonated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_source_commercial_offer_id_commercial_offer_id_fk" FOREIGN KEY ("source_commercial_offer_id") REFERENCES "public"."commercial_offer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_record" ADD CONSTRAINT "training_record_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_record" ADD CONSTRAINT "training_record_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_record" ADD CONSTRAINT "training_record_competence_id_personnel_competence_id_fk" FOREIGN KEY ("competence_id") REFERENCES "public"."personnel_competence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_record" ADD CONSTRAINT "training_record_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_record_audit_log" ADD CONSTRAINT "training_record_audit_log_training_record_id_training_record_id_fk" FOREIGN KEY ("training_record_id") REFERENCES "public"."training_record"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "asset_unit_id_idx" ON "asset" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "asset_customer_id_idx" ON "asset" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "asset_type_id_idx" ON "asset" USING btree ("asset_type_id");--> statement-breakpoint
CREATE INDEX "asset_status_idx" ON "asset" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_tag_uidx" ON "asset" USING btree ("tag");--> statement-breakpoint
CREATE INDEX "asset_audit_log_asset_id_idx" ON "asset_audit_log" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_audit_log_performed_at_idx" ON "asset_audit_log" USING btree ("performed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_type_slug_uidx" ON "asset_type" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "billing_contact_org_idx" ON "billing_contact" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "billing_contact_primary_idx" ON "billing_contact" USING btree ("organization_id","is_primary");--> statement-breakpoint
CREATE INDEX "billing_customer_org_idx" ON "billing_customer" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "billing_customer_status_idx" ON "billing_customer" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_customer_org_provider_uidx" ON "billing_customer" USING btree ("organization_id","provider");--> statement-breakpoint
CREATE INDEX "job_unit_id_idx" ON "calibration_job" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "job_organization_id_idx" ON "calibration_job" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "job_customer_id_idx" ON "calibration_job" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "job_asset_id_idx" ON "calibration_job" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "job_service_id_idx" ON "calibration_job" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "job_technician_id_idx" ON "calibration_job" USING btree ("technician_id");--> statement-breakpoint
CREATE INDEX "job_status_idx" ON "calibration_job" USING btree ("status");--> statement-breakpoint
CREATE INDEX "job_due_date_idx" ON "calibration_job" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "job_org_status_due_idx" ON "calibration_job" USING btree ("organization_id","status","due_date");--> statement-breakpoint
CREATE INDEX "job_org_status_approved_at_idx" ON "calibration_job" USING btree ("organization_id","status","approved_at");--> statement-breakpoint
CREATE INDEX "job_org_status_rejected_at_idx" ON "calibration_job" USING btree ("organization_id","status","rejected_at");--> statement-breakpoint
CREATE INDEX "job_org_created_at_idx" ON "calibration_job" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_org_job_id_uidx" ON "calibration_job" USING btree ("organization_id","job_id");--> statement-breakpoint
CREATE INDEX "job_supersedes_id_idx" ON "calibration_job" USING btree ("supersedes_id");--> statement-breakpoint
CREATE INDEX "job_superseded_by_id_idx" ON "calibration_job" USING btree ("superseded_by_id");--> statement-breakpoint
CREATE INDEX "job_certificate_template_id_idx" ON "calibration_job" USING btree ("certificate_template_id");--> statement-breakpoint
CREATE INDEX "method_organization_id_idx" ON "calibration_method" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "method_asset_type_id_idx" ON "calibration_method" USING btree ("asset_type_id");--> statement-breakpoint
CREATE INDEX "method_status_idx" ON "calibration_method" USING btree ("status");--> statement-breakpoint
CREATE INDEX "method_parent_id_idx" ON "calibration_method" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "method_org_name_version_uidx" ON "calibration_method" USING btree ("organization_id","name","version");--> statement-breakpoint
CREATE INDEX "calibration_request_unit_id_idx" ON "calibration_request" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "calibration_request_org_id_idx" ON "calibration_request" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "calibration_request_customer_id_idx" ON "calibration_request" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "calibration_request_auth_org_id_idx" ON "calibration_request" USING btree ("auth_organization_id");--> statement-breakpoint
CREATE INDEX "calibration_request_status_idx" ON "calibration_request" USING btree ("status");--> statement-breakpoint
CREATE INDEX "calibration_request_submitted_at_idx" ON "calibration_request" USING btree ("submitted_at");--> statement-breakpoint
CREATE INDEX "cal_request_audit_log_request_id_idx" ON "calibration_request_audit_log" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "cal_request_audit_log_performed_at_idx" ON "calibration_request_audit_log" USING btree ("performed_at");--> statement-breakpoint
CREATE INDEX "calibration_request_item_request_id_idx" ON "calibration_request_item" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "calibration_request_item_asset_id_idx" ON "calibration_request_item" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "calibration_request_item_job_id_idx" ON "calibration_request_item" USING btree ("converted_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calibration_request_item_request_asset_uidx" ON "calibration_request_item" USING btree ("request_id","asset_id");--> statement-breakpoint
CREATE INDEX "certificate_template_org_id_idx" ON "certificate_template" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "certificate_template_status_idx" ON "certificate_template" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_template_org_slug_uidx" ON "certificate_template" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "commercial_deal_org_idx" ON "commercial_deal" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "commercial_deal_status_idx" ON "commercial_deal" USING btree ("status");--> statement-breakpoint
CREATE INDEX "commercial_offer_org_idx" ON "commercial_offer" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "commercial_offer_deal_idx" ON "commercial_offer" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "commercial_offer_status_idx" ON "commercial_offer" USING btree ("status");--> statement-breakpoint
CREATE INDEX "commercial_offer_kind_idx" ON "commercial_offer" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_offer_provider_checkout_uidx" ON "commercial_offer" USING btree ("provider_checkout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_offer_provider_payment_uidx" ON "commercial_offer" USING btree ("provider_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_offer_provider_subscription_uidx" ON "commercial_offer" USING btree ("provider_subscription_id");--> statement-breakpoint
CREATE INDEX "commercial_offer_item_offer_idx" ON "commercial_offer_item" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "commercial_offer_history_offer_idx" ON "commercial_offer_status_history" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "commercial_offer_history_source_event_idx" ON "commercial_offer_status_history" USING btree ("source_event_id");--> statement-breakpoint
CREATE INDEX "capa_organization_id_idx" ON "corrective_action" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "capa_status_idx" ON "corrective_action" USING btree ("status");--> statement-breakpoint
CREATE INDEX "capa_responsible_id_idx" ON "corrective_action" USING btree ("responsible_id");--> statement-breakpoint
CREATE INDEX "capa_severity_idx" ON "corrective_action" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "capa_category_idx" ON "corrective_action" USING btree ("category");--> statement-breakpoint
CREATE INDEX "capa_source_idx" ON "corrective_action" USING btree ("source");--> statement-breakpoint
CREATE UNIQUE INDEX "capa_number_uidx" ON "corrective_action" USING btree ("capa_number");--> statement-breakpoint
CREATE INDEX "capa_audit_log_capa_id_idx" ON "corrective_action_audit_log" USING btree ("capa_id");--> statement-breakpoint
CREATE INDEX "capa_audit_log_performed_at_idx" ON "corrective_action_audit_log" USING btree ("performed_at");--> statement-breakpoint
CREATE INDEX "customer_auth_org_id_idx" ON "customer" USING btree ("auth_organization_id");--> statement-breakpoint
CREATE INDEX "customer_lab_org_id_idx" ON "customer" USING btree ("lab_organization_id");--> statement-breakpoint
CREATE INDEX "customer_audit_log_customer_id_idx" ON "customer_audit_log" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_audit_log_performed_at_idx" ON "customer_audit_log" USING btree ("performed_at");--> statement-breakpoint
CREATE INDEX "env_limits_organization_id_idx" ON "environmental_limits" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "env_limits_unit_id_idx" ON "environmental_limits" USING btree ("unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connection_integration_uidx" ON "integration_connection" USING btree ("integration_id");--> statement-breakpoint
CREATE INDEX "integration_connection_org_id_idx" ON "integration_connection" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "integration_event_log_integration_idx" ON "integration_event_log" USING btree ("integration_id");--> statement-breakpoint
CREATE INDEX "integration_event_log_org_idx" ON "integration_event_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "integration_event_log_run_idx" ON "integration_event_log" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "integration_event_log_created_at_idx" ON "integration_event_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_object_link_local_uidx" ON "integration_object_link" USING btree ("integration_id","target","local_entity_id");--> statement-breakpoint
CREATE INDEX "integration_object_link_remote_idx" ON "integration_object_link" USING btree ("integration_id","target","remote_entity_id");--> statement-breakpoint
CREATE INDEX "integration_sync_run_integration_idx" ON "integration_sync_run" USING btree ("integration_id");--> statement-breakpoint
CREATE INDEX "integration_sync_run_org_idx" ON "integration_sync_run" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "integration_sync_run_status_idx" ON "integration_sync_run" USING btree ("status");--> statement-breakpoint
CREATE INDEX "integration_sync_run_created_at_idx" ON "integration_sync_run" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "job_audit_log_job_id_idx" ON "job_audit_log" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_audit_log_performed_at_idx" ON "job_audit_log" USING btree ("performed_at");--> statement-breakpoint
CREATE INDEX "job_audit_log_action_idx" ON "job_audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "member_unit_assignment_org_id_idx" ON "member_unit_assignment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_unit_assignment_member_id_idx" ON "member_unit_assignment" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "member_unit_assignment_unit_id_idx" ON "member_unit_assignment" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "member_visual_sig_org_id_idx" ON "member_visual_signature" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_visual_sig_unique_idx" ON "member_visual_signature" USING btree ("member_id","organization_id");--> statement-breakpoint
CREATE INDEX "method_audit_log_method_id_idx" ON "method_audit_log" USING btree ("method_id");--> statement-breakpoint
CREATE INDEX "method_audit_log_performed_at_idx" ON "method_audit_log" USING btree ("performed_at");--> statement-breakpoint
CREATE INDEX "nc_organization_id_idx" ON "non_conformance" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "nc_job_id_idx" ON "non_conformance" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "nc_status_idx" ON "non_conformance" USING btree ("status");--> statement-breakpoint
CREATE INDEX "nc_type_idx" ON "non_conformance" USING btree ("type");--> statement-breakpoint
CREATE INDEX "nc_detected_at_idx" ON "non_conformance" USING btree ("detected_at");--> statement-breakpoint
CREATE INDEX "nc_capa_id_idx" ON "non_conformance" USING btree ("capa_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nc_number_uidx" ON "non_conformance" USING btree ("nc_number");--> statement-breakpoint
CREATE INDEX "nc_audit_log_nc_id_idx" ON "non_conformance_audit_log" USING btree ("nc_id");--> statement-breakpoint
CREATE INDEX "nc_audit_log_performed_at_idx" ON "non_conformance_audit_log" USING btree ("performed_at");--> statement-breakpoint
CREATE INDEX "notification_recipient_user_id_idx" ON "notification" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "notification_organization_id_idx" ON "notification" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "notification_status_idx" ON "notification" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notification_type_idx" ON "notification" USING btree ("type");--> statement-breakpoint
CREATE INDEX "notification_created_at_idx" ON "notification" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preference_user_id_uidx" ON "notification_preference" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "organization_api_key_org_id_idx" ON "organization_api_key" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_api_key_hash_uidx" ON "organization_api_key" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "organization_api_key_audit_log_key_idx" ON "organization_api_key_audit_log" USING btree ("api_key_id");--> statement-breakpoint
CREATE INDEX "organization_api_key_audit_log_org_idx" ON "organization_api_key_audit_log" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_custom_domain_org_uidx" ON "organization_custom_domain" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_custom_domain_hostname_uidx" ON "organization_custom_domain" USING btree ("hostname");--> statement-breakpoint
CREATE INDEX "org_custom_domain_active_idx" ON "organization_custom_domain" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "organization_event_log_org_id_idx" ON "organization_event_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_event_log_unit_id_idx" ON "organization_event_log" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "organization_event_log_action_idx" ON "organization_event_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "organization_event_log_created_at_idx" ON "organization_event_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "organization_integration_org_id_idx" ON "organization_integration" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_integration_status_idx" ON "organization_integration" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_integration_id_org_uidx" ON "organization_integration" USING btree ("id","organization_id");--> statement-breakpoint
CREATE INDEX "org_signing_cert_org_id_idx" ON "organization_signing_certificate" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "org_signing_cert_unit_id_idx" ON "organization_signing_certificate" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "org_signing_cert_valid_until_idx" ON "organization_signing_certificate" USING btree ("valid_until");--> statement-breakpoint
CREATE INDEX "org_signing_cert_is_default_idx" ON "organization_signing_certificate" USING btree ("organization_id","unit_id","is_default");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_success_profile_org_uidx" ON "organization_success_profile" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_success_profile_onboarding_idx" ON "organization_success_profile" USING btree ("onboarding_status");--> statement-breakpoint
CREATE INDEX "organization_success_profile_migration_idx" ON "organization_success_profile" USING btree ("migration_status");--> statement-breakpoint
CREATE INDEX "organization_success_profile_go_live_idx" ON "organization_success_profile" USING btree ("go_live_status");--> statement-breakpoint
CREATE INDEX "organization_success_profile_health_idx" ON "organization_success_profile" USING btree ("health_status");--> statement-breakpoint
CREATE INDEX "organization_success_profile_priority_support_idx" ON "organization_success_profile" USING btree ("priority_support");--> statement-breakpoint
CREATE INDEX "organization_success_profile_next_action_due_idx" ON "organization_success_profile" USING btree ("next_action_due_at");--> statement-breakpoint
CREATE INDEX "organization_support_request_org_idx" ON "organization_support_request" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_support_request_status_idx" ON "organization_support_request" USING btree ("status");--> statement-breakpoint
CREATE INDEX "organization_support_request_priority_idx" ON "organization_support_request" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "organization_support_request_escalated_at_idx" ON "organization_support_request" USING btree ("escalated_at");--> statement-breakpoint
CREATE INDEX "organization_support_request_created_at_idx" ON "organization_support_request" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "organization_support_request_event_request_idx" ON "organization_support_request_event" USING btree ("support_request_id");--> statement-breakpoint
CREATE INDEX "organization_support_request_event_org_idx" ON "organization_support_request_event" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_support_request_event_kind_idx" ON "organization_support_request_event" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "organization_support_request_event_created_at_idx" ON "organization_support_request_event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "organization_unit_org_id_idx" ON "organization_unit" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_unit_status_idx" ON "organization_unit" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_unit_org_slug_uidx" ON "organization_unit" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "payment_record_offer_idx" ON "payment_record" USING btree ("commercial_offer_id");--> statement-breakpoint
CREATE INDEX "payment_record_org_idx" ON "payment_record" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "payment_record_status_idx" ON "payment_record" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_record_provider_payment_uidx" ON "payment_record" USING btree ("provider_payment_id");--> statement-breakpoint
CREATE INDEX "payment_status_history_payment_idx" ON "payment_status_history" USING btree ("payment_record_id");--> statement-breakpoint
CREATE INDEX "payment_status_history_offer_idx" ON "payment_status_history" USING btree ("commercial_offer_id");--> statement-breakpoint
CREATE INDEX "competence_organization_id_idx" ON "personnel_competence" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "competence_user_id_idx" ON "personnel_competence" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "competence_asset_type_id_idx" ON "personnel_competence" USING btree ("asset_type_id");--> statement-breakpoint
CREATE INDEX "competence_status_idx" ON "personnel_competence" USING btree ("status");--> statement-breakpoint
CREATE INDEX "competence_expires_at_idx" ON "personnel_competence" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "competence_audit_log_competence_id_idx" ON "personnel_competence_audit_log" USING btree ("competence_id");--> statement-breakpoint
CREATE INDEX "competence_audit_log_performed_at_idx" ON "personnel_competence_audit_log" USING btree ("performed_at");--> statement-breakpoint
CREATE INDEX "platform_event_log_action_idx" ON "platform_event_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "platform_event_log_actor_user_idx" ON "platform_event_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "platform_event_log_target_user_idx" ON "platform_event_log" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX "platform_event_log_created_at_idx" ON "platform_event_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_webhook_event_uidx" ON "provider_webhook_event" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "provider_webhook_event_type_idx" ON "provider_webhook_event" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "provider_webhook_event_created_idx" ON "provider_webhook_event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "public_api_idempotency_org_idx" ON "public_api_idempotency_key" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "public_api_idempotency_api_key_idx" ON "public_api_idempotency_key" USING btree ("api_key_id");--> statement-breakpoint
CREATE UNIQUE INDEX "public_api_idempotency_request_uidx" ON "public_api_idempotency_key" USING btree ("organization_id","api_key_id","request_method","request_path","idempotency_key");--> statement-breakpoint
CREATE INDEX "public_api_resource_ref_org_idx" ON "public_api_resource_ref" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "public_api_resource_ref_type_idx" ON "public_api_resource_ref" USING btree ("resource_type");--> statement-breakpoint
CREATE UNIQUE INDEX "public_api_resource_ref_external_uidx" ON "public_api_resource_ref" USING btree ("organization_id","resource_type","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "public_api_resource_ref_resource_uidx" ON "public_api_resource_ref" USING btree ("organization_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "public_api_webhook_delivery_subscription_idx" ON "public_api_webhook_delivery" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "public_api_webhook_delivery_org_idx" ON "public_api_webhook_delivery" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "public_api_webhook_delivery_event_idx" ON "public_api_webhook_delivery" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "public_api_webhook_delivery_status_idx" ON "public_api_webhook_delivery" USING btree ("status");--> statement-breakpoint
CREATE INDEX "public_api_webhook_subscription_org_idx" ON "public_api_webhook_subscription" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "public_api_webhook_subscription_status_idx" ON "public_api_webhook_subscription" USING btree ("status");--> statement-breakpoint
CREATE INDEX "standard_unit_id_idx" ON "reference_standard" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "standard_organization_id_idx" ON "reference_standard" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "standard_status_idx" ON "reference_standard" USING btree ("status");--> statement-breakpoint
CREATE INDEX "standard_next_cal_date_idx" ON "reference_standard" USING btree ("next_calibration_date");--> statement-breakpoint
CREATE INDEX "standard_audit_log_standard_id_idx" ON "reference_standard_audit_log" USING btree ("standard_id");--> statement-breakpoint
CREATE INDEX "standard_audit_log_performed_at_idx" ON "reference_standard_audit_log" USING btree ("performed_at");--> statement-breakpoint
CREATE INDEX "scheduled_notification_organization_id_idx" ON "scheduled_notification" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "scheduled_notification_scheduled_for_idx" ON "scheduled_notification" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "scheduled_notification_entity_idx" ON "scheduled_notification" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_notification_unique_idx" ON "scheduled_notification" USING btree ("organization_id","type","entity_type","entity_id","lead_time_days");--> statement-breakpoint
CREATE INDEX "service_unit_id_idx" ON "service" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "service_organization_id_idx" ON "service" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "service_method_id_idx" ON "service" USING btree ("method_id");--> statement-breakpoint
CREATE INDEX "service_asset_type_id_idx" ON "service" USING btree ("asset_type_id");--> statement-breakpoint
CREATE INDEX "service_is_active_idx" ON "service" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "service_audit_log_service_id_idx" ON "service_audit_log" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "service_audit_log_performed_at_idx" ON "service_audit_log" USING btree ("performed_at");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sso_provider_user_id_idx" ON "sso_provider" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sso_provider_org_id_idx" ON "sso_provider" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sso_provider_org_id_uidx" ON "sso_provider" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "subscription_org_id_idx" ON "subscription" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "subscription_status_idx" ON "subscription" USING btree ("status");--> statement-breakpoint
CREATE INDEX "subscription_provider_sub_id_idx" ON "subscription" USING btree ("provider_subscription_id");--> statement-breakpoint
CREATE INDEX "training_organization_id_idx" ON "training_record" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "training_user_id_idx" ON "training_record" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "training_competence_id_idx" ON "training_record" USING btree ("competence_id");--> statement-breakpoint
CREATE INDEX "training_status_idx" ON "training_record" USING btree ("status");--> statement-breakpoint
CREATE INDEX "training_start_date_idx" ON "training_record" USING btree ("start_date");--> statement-breakpoint
CREATE INDEX "training_audit_log_training_id_idx" ON "training_record_audit_log" USING btree ("training_record_id");--> statement-breakpoint
CREATE INDEX "training_audit_log_performed_at_idx" ON "training_record_audit_log" USING btree ("performed_at");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");