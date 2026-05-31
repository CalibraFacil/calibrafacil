-- Phase 2 slice 4: automatic send rules by milestone.
--
-- Mirrors the certificate-release-policy shape so the policy +
-- override resolution logic can be shared across slices. Triggered
-- by certificate-approval / SO-delivery / contract-anniversary
-- events and fires the existing sendServiceOrdersToFinance pathway.
-- Additive only.

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
ALTER TABLE "automatic_send_rule" ADD CONSTRAINT "automatic_send_rule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "automatic_send_rule" ADD CONSTRAINT "automatic_send_rule_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "automatic_send_rule" ADD CONSTRAINT "automatic_send_rule_commercial_agreement_id_commercial_agreement_id_fk" FOREIGN KEY ("commercial_agreement_id") REFERENCES "public"."commercial_agreement"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "automatic_send_rule" ADD CONSTRAINT "automatic_send_rule_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "automatic_send_rule_org_idx" ON "automatic_send_rule" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "automatic_send_rule_customer_idx" ON "automatic_send_rule" USING btree ("organization_id","customer_id");
--> statement-breakpoint
CREATE INDEX "automatic_send_rule_agreement_idx" ON "automatic_send_rule" USING btree ("organization_id","commercial_agreement_id");
--> statement-breakpoint
CREATE INDEX "automatic_send_rule_category_idx" ON "automatic_send_rule" USING btree ("organization_id","service_category");
--> statement-breakpoint
-- One active org-default rule per organization. Same pattern as the
-- certificate-release-policy default uniqueness.
CREATE UNIQUE INDEX "automatic_send_rule_org_default_uidx"
  ON "automatic_send_rule" ("organization_id")
  WHERE "customer_id" IS NULL
    AND "commercial_agreement_id" IS NULL
    AND "service_category" IS NULL
    AND "archived_at" IS NULL;
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
ALTER TABLE "automatic_send_audit_log" ADD CONSTRAINT "automatic_send_audit_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "automatic_send_audit_log" ADD CONSTRAINT "automatic_send_audit_log_service_order_id_service_order_id_fk" FOREIGN KEY ("service_order_id") REFERENCES "public"."service_order"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "automatic_send_audit_log" ADD CONSTRAINT "automatic_send_audit_log_applied_rule_id_automatic_send_rule_id_fk" FOREIGN KEY ("applied_rule_id") REFERENCES "public"."automatic_send_rule"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "automatic_send_audit_log" ADD CONSTRAINT "automatic_send_audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "automatic_send_audit_org_idx" ON "automatic_send_audit_log" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "automatic_send_audit_so_idx" ON "automatic_send_audit_log" USING btree ("service_order_id");
--> statement-breakpoint
CREATE INDEX "automatic_send_audit_created_idx" ON "automatic_send_audit_log" USING btree ("created_at");
--> statement-breakpoint

-- Backfill: every existing organization gets a manual_only org default.
INSERT INTO "automatic_send_rule" ("organization_id", "milestone", "priority")
SELECT "id", 'manual_only', 0 FROM "organization"
ON CONFLICT DO NOTHING;
