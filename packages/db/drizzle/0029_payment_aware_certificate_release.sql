-- Phase 2 slice 1: payment-aware certificate release.
--
-- Three new tables that separate technical certificate approval
-- (calibration_job.status = 'APPROVED') from commercial release
-- to the customer portal. Driven by a per-org / per-customer /
-- per-contract / per-service-category policy that consumes the
-- Phase 1 read model.
--
-- ERP payment status must never mutate calibration_job.status or
-- issued_certificate_snapshot.status. This migration is additive only.

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
ALTER TABLE "certificate_release_policy" ADD CONSTRAINT "certificate_release_policy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_release_policy" ADD CONSTRAINT "certificate_release_policy_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_release_policy" ADD CONSTRAINT "certificate_release_policy_commercial_agreement_id_commercial_agreement_id_fk" FOREIGN KEY ("commercial_agreement_id") REFERENCES "public"."commercial_agreement"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_release_policy" ADD CONSTRAINT "certificate_release_policy_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "certificate_release_policy_org_idx" ON "certificate_release_policy" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "certificate_release_policy_customer_idx" ON "certificate_release_policy" USING btree ("organization_id","customer_id");
--> statement-breakpoint
CREATE INDEX "certificate_release_policy_agreement_idx" ON "certificate_release_policy" USING btree ("organization_id","commercial_agreement_id");
--> statement-breakpoint
CREATE INDEX "certificate_release_policy_category_idx" ON "certificate_release_policy" USING btree ("organization_id","service_category");
--> statement-breakpoint
-- One active org-default policy per organization. The "org default" is the
-- row where customer_id, commercial_agreement_id, and service_category are
-- all NULL. NULLS NOT DISTINCT ensures the uniqueness applies across NULL
-- combinations for non-archived rows. archived_at IS NULL is enforced at
-- the application layer in resolveCertificateReleasePolicy.
CREATE UNIQUE INDEX "certificate_release_policy_org_default_uidx"
  ON "certificate_release_policy" ("organization_id")
  WHERE "customer_id" IS NULL
    AND "commercial_agreement_id" IS NULL
    AND "service_category" IS NULL
    AND "archived_at" IS NULL;
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
ALTER TABLE "certificate_release" ADD CONSTRAINT "certificate_release_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_release" ADD CONSTRAINT "certificate_release_calibration_job_id_calibration_job_id_fk" FOREIGN KEY ("calibration_job_id") REFERENCES "public"."calibration_job"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_release" ADD CONSTRAINT "certificate_release_applied_policy_id_certificate_release_policy_id_fk" FOREIGN KEY ("applied_policy_id") REFERENCES "public"."certificate_release_policy"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_release" ADD CONSTRAINT "certificate_release_released_by_user_id_user_id_fk" FOREIGN KEY ("released_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_release_job_uidx" ON "certificate_release" USING btree ("calibration_job_id");
--> statement-breakpoint
CREATE INDEX "certificate_release_org_idx" ON "certificate_release" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "certificate_release_status_idx" ON "certificate_release" USING btree ("organization_id","status");
--> statement-breakpoint
CREATE INDEX "certificate_release_policy_idx" ON "certificate_release" USING btree ("applied_policy_id");
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
ALTER TABLE "certificate_release_audit_log" ADD CONSTRAINT "certificate_release_audit_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_release_audit_log" ADD CONSTRAINT "certificate_release_audit_log_certificate_release_id_certificate_release_id_fk" FOREIGN KEY ("certificate_release_id") REFERENCES "public"."certificate_release"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_release_audit_log" ADD CONSTRAINT "certificate_release_audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_release_audit_log" ADD CONSTRAINT "certificate_release_audit_log_applied_policy_id_certificate_release_policy_id_fk" FOREIGN KEY ("applied_policy_id") REFERENCES "public"."certificate_release_policy"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "certificate_release_audit_org_idx" ON "certificate_release_audit_log" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "certificate_release_audit_release_idx" ON "certificate_release_audit_log" USING btree ("certificate_release_id");
--> statement-breakpoint
CREATE INDEX "certificate_release_audit_created_idx" ON "certificate_release_audit_log" USING btree ("created_at");
--> statement-breakpoint

-- Backfill: every existing organization gets an org-default policy with
-- mode = 'manual_only' so new approved certificates default to RELEASED
-- (preserves Phase 1 behavior, opt-in payment-aware mode).
INSERT INTO "certificate_release_policy" ("organization_id", "mode", "priority")
SELECT "id", 'manual_only', 0 FROM "organization"
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Backfill: every existing approved or superseded calibration job gets a
-- certificate_release row with status = RELEASED. Preserves existing portal
-- and internal behavior (no held certificates on launch). Cross-table insert
-- selects organization_id from the job to keep tenant scoping consistent.
INSERT INTO "certificate_release" (
  "organization_id",
  "calibration_job_id",
  "status",
  "applied_policy_id",
  "last_evaluated_at",
  "payment_state_snapshot"
)
SELECT
  "calibration_job"."organization_id",
  "calibration_job"."id",
  'RELEASED',
  NULL,
  now(),
  'null'::jsonb
FROM "calibration_job"
WHERE "calibration_job"."status" IN ('APPROVED', 'SUPERSEDED')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Backfill audit row marking the source of every new release row.
INSERT INTO "certificate_release_audit_log" (
  "organization_id",
  "certificate_release_id",
  "actor_user_id",
  "from_status",
  "to_status",
  "applied_policy_id",
  "payment_state_snapshot",
  "reason",
  "source"
)
SELECT
  "certificate_release"."organization_id",
  "certificate_release"."id",
  NULL,
  NULL,
  "certificate_release"."status",
  NULL,
  NULL,
  NULL,
  'backfill'
FROM "certificate_release"
WHERE NOT EXISTS (
  SELECT 1
  FROM "certificate_release_audit_log"
  WHERE "certificate_release_audit_log"."certificate_release_id" = "certificate_release"."id"
    AND "certificate_release_audit_log"."source" = 'backfill'
);
