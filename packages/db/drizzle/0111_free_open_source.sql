-- Calibra Fácil is free, open-source software: every laboratory gets every
-- feature with no plan limits. Drop what only served the former commercial
-- service: plans and subscriptions, commercial offers and payments (Asaas),
-- the vendor's customer-success program, marketing leads, and the operator
-- console (billing approvals, entitlement overrides, account tasks and
-- interactions, imports, operator alerts) with its two-factor sign-in.
DROP TABLE IF EXISTS "payment_status_history" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "payment_record" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "provider_webhook_event" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "commercial_offer_access_log" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "commercial_offer_status_history" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "commercial_offer_item" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "subscription" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "commercial_offer" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "commercial_deal" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "billing_contact" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "billing_customer" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "entitlement_override" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "approval_request" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "account_task" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "account_interaction" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "import_run" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "operator_alert" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "organization_support_request_event" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "organization_support_request" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "organization_success_profile" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "leads" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "twoFactor" CASCADE;--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN IF EXISTS "two_factor_enabled";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN IF EXISTS "asaas_customer_id";
