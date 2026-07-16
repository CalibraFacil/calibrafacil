-- #427 Accredited-scope (CMC) guard — ISO/IEC 17025 §7.6/§7.8.3, ILAC P14.
-- Phase 0 (model + warn): one scope line per grandeza × faixa × CMC per lab
-- unit, an append-only audit trail for scope edits (§8.4), and two frozen
-- classification columns on calibration_job stamped at submit/approval.
-- CMC(x) = cmc_a + cmc_b·|x| with x in range_unit and the result in cmc_unit;
-- 'fixed' ignores cmc_b. Additive — no existing query is affected.
CREATE TABLE IF NOT EXISTS "accredited_scope_line" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"unit_id" integer NOT NULL,
	"quantity_kind" text NOT NULL,
	"range_min" double precision NOT NULL,
	"range_max" double precision NOT NULL,
	"range_unit" text NOT NULL,
	"cmc_type" text DEFAULT 'fixed' NOT NULL,
	"cmc_a" double precision NOT NULL,
	"cmc_b" double precision,
	"cmc_unit" text NOT NULL,
	"coverage_factor" double precision DEFAULT 2 NOT NULL,
	"description" text,
	"valid_from" timestamp,
	"valid_until" timestamp,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "accredited_scope_line_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope_line_id" integer NOT NULL,
	"organization_id" text NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text
);--> statement-breakpoint
ALTER TABLE "accredited_scope_line" ADD CONSTRAINT "accredited_scope_line_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accredited_scope_line" ADD CONSTRAINT "accredited_scope_line_unit_id_organization_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accredited_scope_line" ADD CONSTRAINT "accredited_scope_line_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accredited_scope_line_audit_log" ADD CONSTRAINT "accredited_scope_line_audit_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accredited_scope_line_audit_log" ADD CONSTRAINT "accredited_scope_line_audit_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accredited_scope_line_organization_id_idx" ON "accredited_scope_line" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accredited_scope_line_unit_id_idx" ON "accredited_scope_line" ("unit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accredited_scope_line_audit_log_line_idx" ON "accredited_scope_line_audit_log" ("scope_line_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accredited_scope_line_audit_log_org_idx" ON "accredited_scope_line_audit_log" ("organization_id");--> statement-breakpoint
ALTER TABLE "calibration_job" ADD COLUMN IF NOT EXISTS "scope_compliance_status" text;--> statement-breakpoint
ALTER TABLE "calibration_job" ADD COLUMN IF NOT EXISTS "scope_compliance_findings" jsonb;
