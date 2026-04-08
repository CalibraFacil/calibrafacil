CREATE TABLE "personnel_competence" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "asset_type_id" integer REFERENCES "asset_type"("id") ON DELETE set null,
  "scope_description" text NOT NULL,
  "status" text DEFAULT 'REQUESTED' NOT NULL,
  "qualified_at" timestamp,
  "expires_at" timestamp,
  "certificate_r2_key" text,
  "certificate_file_name" text,
  "notes" text,
  "requested_by" text NOT NULL REFERENCES "user"("id"),
  "evaluated_by" text REFERENCES "user"("id"),
  "approved_by" text REFERENCES "user"("id"),
  "created_by" text NOT NULL REFERENCES "user"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp
);
--> statement-breakpoint

CREATE INDEX "competence_organization_id_idx"
  ON "personnel_competence" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "competence_user_id_idx"
  ON "personnel_competence" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "competence_asset_type_id_idx"
  ON "personnel_competence" USING btree ("asset_type_id");
--> statement-breakpoint
CREATE INDEX "competence_status_idx"
  ON "personnel_competence" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "competence_expires_at_idx"
  ON "personnel_competence" USING btree ("expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "competence_org_user_asset_type_uidx"
  ON "personnel_competence" USING btree ("organization_id", "user_id", "asset_type_id") NULLS NOT DISTINCT;
--> statement-breakpoint

CREATE TABLE "training_record" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "competence_id" integer REFERENCES "personnel_competence"("id") ON DELETE set null,
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
  "created_by" text NOT NULL REFERENCES "user"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp
);
--> statement-breakpoint

CREATE INDEX "training_organization_id_idx"
  ON "training_record" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "training_user_id_idx"
  ON "training_record" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "training_competence_id_idx"
  ON "training_record" USING btree ("competence_id");
--> statement-breakpoint
CREATE INDEX "training_status_idx"
  ON "training_record" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "training_start_date_idx"
  ON "training_record" USING btree ("start_date");
--> statement-breakpoint

CREATE TABLE "personnel_competence_audit_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "competence_id" integer NOT NULL REFERENCES "personnel_competence"("id") ON DELETE cascade,
  "action" text NOT NULL,
  "changes" jsonb,
  "performed_by" text NOT NULL,
  "performed_at" timestamp DEFAULT now() NOT NULL,
  "ip_address" text,
  "reason" text
);
--> statement-breakpoint

CREATE INDEX "competence_audit_log_competence_id_idx"
  ON "personnel_competence_audit_log" USING btree ("competence_id");
--> statement-breakpoint
CREATE INDEX "competence_audit_log_performed_at_idx"
  ON "personnel_competence_audit_log" USING btree ("performed_at");
--> statement-breakpoint

CREATE TABLE "training_record_audit_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "training_record_id" integer NOT NULL REFERENCES "training_record"("id") ON DELETE cascade,
  "action" text NOT NULL,
  "changes" jsonb,
  "performed_by" text NOT NULL,
  "performed_at" timestamp DEFAULT now() NOT NULL,
  "ip_address" text,
  "reason" text
);
--> statement-breakpoint

CREATE INDEX "training_audit_log_training_id_idx"
  ON "training_record_audit_log" USING btree ("training_record_id");
--> statement-breakpoint
CREATE INDEX "training_audit_log_performed_at_idx"
  ON "training_record_audit_log" USING btree ("performed_at");
