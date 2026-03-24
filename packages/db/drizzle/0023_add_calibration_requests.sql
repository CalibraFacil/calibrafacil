CREATE TABLE "calibration_request" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "customer_id" integer NOT NULL,
  "auth_organization_id" text NOT NULL,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "observations" text,
  "internal_notes" text,
  "requested_due_date" timestamptz,
  "submitted_by" text NOT NULL,
  "submitted_at" timestamptz DEFAULT now() NOT NULL,
  "reviewed_by" text,
  "reviewed_at" timestamptz,
  "approved_by" text,
  "approved_at" timestamptz,
  "rejected_by" text,
  "rejected_at" timestamptz,
  "rejection_reason" text,
  "converted_by" text,
  "converted_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "calibration_request_status_check"
    CHECK ("status" IN (
      'PENDING',
      'UNDER_REVIEW',
      'APPROVED',
      'REJECTED',
      'CONVERTED'
    ))
);
--> statement-breakpoint
CREATE TABLE "calibration_request_item" (
  "id" serial PRIMARY KEY NOT NULL,
  "request_id" integer NOT NULL,
  "asset_id" integer NOT NULL,
  "converted_job_id" integer,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calibration_request_audit_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "request_id" integer NOT NULL,
  "action" text NOT NULL,
  "changes" jsonb,
  "performed_by" text NOT NULL,
  "performed_at" timestamptz DEFAULT now() NOT NULL,
  "ip_address" text,
  "reason" text
);
--> statement-breakpoint
ALTER TABLE "calibration_request"
  ADD CONSTRAINT "calibration_request_organization_id_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calibration_request"
  ADD CONSTRAINT "calibration_request_customer_id_customer_id_fk"
  FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calibration_request"
  ADD CONSTRAINT "calibration_request_auth_organization_id_organization_id_fk"
  FOREIGN KEY ("auth_organization_id") REFERENCES "public"."organization"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calibration_request"
  ADD CONSTRAINT "calibration_request_submitted_by_user_id_fk"
  FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calibration_request"
  ADD CONSTRAINT "calibration_request_reviewed_by_user_id_fk"
  FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calibration_request"
  ADD CONSTRAINT "calibration_request_approved_by_user_id_fk"
  FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calibration_request"
  ADD CONSTRAINT "calibration_request_rejected_by_user_id_fk"
  FOREIGN KEY ("rejected_by") REFERENCES "public"."user"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calibration_request"
  ADD CONSTRAINT "calibration_request_converted_by_user_id_fk"
  FOREIGN KEY ("converted_by") REFERENCES "public"."user"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calibration_request_item"
  ADD CONSTRAINT "calibration_request_item_request_id_calibration_request_id_fk"
  FOREIGN KEY ("request_id") REFERENCES "public"."calibration_request"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calibration_request_item"
  ADD CONSTRAINT "calibration_request_item_asset_id_asset_id_fk"
  FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calibration_request_item"
  ADD CONSTRAINT "calibration_request_item_converted_job_id_calibration_job_id_fk"
  FOREIGN KEY ("converted_job_id") REFERENCES "public"."calibration_job"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calibration_request_audit_log"
  ADD CONSTRAINT "calibration_request_audit_log_request_id_calibration_request_id_fk"
  FOREIGN KEY ("request_id") REFERENCES "public"."calibration_request"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calibration_request_audit_log"
  ADD CONSTRAINT "calibration_request_audit_log_performed_by_user_id_fk"
  FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id")
  ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "calibration_request_org_id_idx"
  ON "calibration_request" ("organization_id");
--> statement-breakpoint
CREATE INDEX "calibration_request_customer_id_idx"
  ON "calibration_request" ("customer_id");
--> statement-breakpoint
CREATE INDEX "calibration_request_auth_org_id_idx"
  ON "calibration_request" ("auth_organization_id");
--> statement-breakpoint
CREATE INDEX "calibration_request_status_idx"
  ON "calibration_request" ("status");
--> statement-breakpoint
CREATE INDEX "calibration_request_submitted_at_idx"
  ON "calibration_request" ("submitted_at");
--> statement-breakpoint
CREATE INDEX "calibration_request_item_request_id_idx"
  ON "calibration_request_item" ("request_id");
--> statement-breakpoint
CREATE INDEX "calibration_request_item_asset_id_idx"
  ON "calibration_request_item" ("asset_id");
--> statement-breakpoint
CREATE INDEX "calibration_request_item_job_id_idx"
  ON "calibration_request_item" ("converted_job_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "calibration_request_item_request_asset_uidx"
  ON "calibration_request_item" ("request_id", "asset_id");
--> statement-breakpoint
CREATE INDEX "cal_request_audit_log_request_id_idx"
  ON "calibration_request_audit_log" ("request_id");
--> statement-breakpoint
CREATE INDEX "cal_request_audit_log_performed_at_idx"
  ON "calibration_request_audit_log" ("performed_at");
