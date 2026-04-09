CREATE TABLE "billing_document" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"customer_id" integer NOT NULL,
	"unit_id" integer NOT NULL,
	"agreement_id" integer,
	"document_number" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"issue_date" timestamp,
	"due_date" timestamp NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"notes" text,
	"issued_by" text,
	"voided_by" text,
	"void_reason" text,
	"export_status" text DEFAULT 'NOT_EXPORTED' NOT NULL,
	"exported_at" timestamp,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_document_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"job_id" integer,
	"job_commercial_snapshot_id" integer,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commercial_agreement" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"customer_id" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"agreement_code" text,
	"title" text NOT NULL,
	"external_reference" text,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"effective_from" timestamp NOT NULL,
	"effective_to" timestamp,
	"default_payment_term_days" integer DEFAULT 28 NOT NULL,
	"notes" text,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commercial_agreement_service_term" (
	"id" serial PRIMARY KEY NOT NULL,
	"agreement_id" integer NOT NULL,
	"service_id" integer NOT NULL,
	"unit_id" integer,
	"price_cents" integer NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"tat_days" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commercial_agreement_unit_scope" (
	"id" serial PRIMARY KEY NOT NULL,
	"agreement_id" integer NOT NULL,
	"unit_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "job_commercial_snapshot" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"organization_id" text NOT NULL,
	"customer_id" integer NOT NULL,
	"unit_id" integer NOT NULL,
	"service_id" integer NOT NULL,
	"agreement_id" integer,
	"source_type" text NOT NULL,
	"service_name" text NOT NULL,
	"price_cents" integer,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"payment_term_days" integer DEFAULT 28 NOT NULL,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	"captured_by_system_version" text NOT NULL,
	CONSTRAINT "job_commercial_snapshot_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "payment_receipt" (
	"id" serial PRIMARY KEY NOT NULL,
	"installment_id" integer NOT NULL,
	"recorded_by" text NOT NULL,
	"received_at" timestamp NOT NULL,
	"amount_cents" integer NOT NULL,
	"payment_method" text NOT NULL,
	"reference" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receivable_installment" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"installment_number" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"due_date" timestamp NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"paid_at" timestamp,
	"payment_method" text,
	"payment_reference" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_document" ADD CONSTRAINT "billing_document_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_document" ADD CONSTRAINT "billing_document_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_document" ADD CONSTRAINT "billing_document_unit_id_organization_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_document" ADD CONSTRAINT "billing_document_agreement_id_commercial_agreement_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."commercial_agreement"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_document" ADD CONSTRAINT "billing_document_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_document" ADD CONSTRAINT "billing_document_voided_by_user_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_document" ADD CONSTRAINT "billing_document_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_document" ADD CONSTRAINT "billing_document_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_document_item" ADD CONSTRAINT "billing_document_item_document_id_billing_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."billing_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_document_item" ADD CONSTRAINT "billing_document_item_job_id_calibration_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."calibration_job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_document_item" ADD CONSTRAINT "billing_document_item_job_commercial_snapshot_id_job_commercial_snapshot_id_fk" FOREIGN KEY ("job_commercial_snapshot_id") REFERENCES "public"."job_commercial_snapshot"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_agreement" ADD CONSTRAINT "commercial_agreement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_agreement" ADD CONSTRAINT "commercial_agreement_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_agreement" ADD CONSTRAINT "commercial_agreement_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_agreement" ADD CONSTRAINT "commercial_agreement_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_agreement_service_term" ADD CONSTRAINT "commercial_agreement_service_term_agreement_id_commercial_agreement_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."commercial_agreement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_agreement_service_term" ADD CONSTRAINT "commercial_agreement_service_term_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_agreement_service_term" ADD CONSTRAINT "commercial_agreement_service_term_unit_id_organization_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_agreement_unit_scope" ADD CONSTRAINT "commercial_agreement_unit_scope_agreement_id_commercial_agreement_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."commercial_agreement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_agreement_unit_scope" ADD CONSTRAINT "commercial_agreement_unit_scope_unit_id_organization_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_audit_log" ADD CONSTRAINT "financial_audit_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_audit_log" ADD CONSTRAINT "financial_audit_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_commercial_snapshot" ADD CONSTRAINT "job_commercial_snapshot_job_id_calibration_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."calibration_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_commercial_snapshot" ADD CONSTRAINT "job_commercial_snapshot_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_commercial_snapshot" ADD CONSTRAINT "job_commercial_snapshot_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_commercial_snapshot" ADD CONSTRAINT "job_commercial_snapshot_unit_id_organization_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."organization_unit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_commercial_snapshot" ADD CONSTRAINT "job_commercial_snapshot_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_commercial_snapshot" ADD CONSTRAINT "job_commercial_snapshot_agreement_id_commercial_agreement_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."commercial_agreement"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_receipt" ADD CONSTRAINT "payment_receipt_installment_id_receivable_installment_id_fk" FOREIGN KEY ("installment_id") REFERENCES "public"."receivable_installment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_receipt" ADD CONSTRAINT "payment_receipt_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_installment" ADD CONSTRAINT "receivable_installment_document_id_billing_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."billing_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_document_org_idx" ON "billing_document" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "billing_document_customer_idx" ON "billing_document" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "billing_document_unit_idx" ON "billing_document" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "billing_document_status_idx" ON "billing_document" USING btree ("status");--> statement-breakpoint
CREATE INDEX "billing_document_due_date_idx" ON "billing_document" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "billing_document_agreement_idx" ON "billing_document" USING btree ("agreement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_document_org_number_uidx" ON "billing_document" USING btree ("organization_id","document_number");--> statement-breakpoint
CREATE INDEX "billing_document_item_document_idx" ON "billing_document_item" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "billing_document_item_job_idx" ON "billing_document_item" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "billing_document_item_snapshot_idx" ON "billing_document_item" USING btree ("job_commercial_snapshot_id");--> statement-breakpoint
CREATE INDEX "commercial_agreement_org_idx" ON "commercial_agreement" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "commercial_agreement_customer_idx" ON "commercial_agreement" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "commercial_agreement_status_idx" ON "commercial_agreement" USING btree ("status");--> statement-breakpoint
CREATE INDEX "commercial_agreement_effective_from_idx" ON "commercial_agreement" USING btree ("effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_agreement_org_code_uidx" ON "commercial_agreement" USING btree ("organization_id","agreement_code");--> statement-breakpoint
CREATE INDEX "commercial_agreement_service_term_agreement_idx" ON "commercial_agreement_service_term" USING btree ("agreement_id");--> statement-breakpoint
CREATE INDEX "commercial_agreement_service_term_service_idx" ON "commercial_agreement_service_term" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "commercial_agreement_service_term_unit_idx" ON "commercial_agreement_service_term" USING btree ("unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_agreement_unit_scope_uidx" ON "commercial_agreement_unit_scope" USING btree ("agreement_id","unit_id");--> statement-breakpoint
CREATE INDEX "commercial_agreement_unit_scope_unit_idx" ON "commercial_agreement_unit_scope" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "financial_audit_log_org_idx" ON "financial_audit_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "financial_audit_log_entity_idx" ON "financial_audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "financial_audit_log_performed_at_idx" ON "financial_audit_log" USING btree ("performed_at");--> statement-breakpoint
CREATE INDEX "job_commercial_snapshot_org_idx" ON "job_commercial_snapshot" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "job_commercial_snapshot_customer_idx" ON "job_commercial_snapshot" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "job_commercial_snapshot_service_idx" ON "job_commercial_snapshot" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "job_commercial_snapshot_agreement_idx" ON "job_commercial_snapshot" USING btree ("agreement_id");--> statement-breakpoint
CREATE INDEX "payment_receipt_installment_idx" ON "payment_receipt" USING btree ("installment_id");--> statement-breakpoint
CREATE INDEX "payment_receipt_received_at_idx" ON "payment_receipt" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "receivable_installment_document_number_uidx" ON "receivable_installment" USING btree ("document_id","installment_number");--> statement-breakpoint
CREATE INDEX "receivable_installment_status_idx" ON "receivable_installment" USING btree ("status");--> statement-breakpoint
CREATE INDEX "receivable_installment_due_date_idx" ON "receivable_installment" USING btree ("due_date");