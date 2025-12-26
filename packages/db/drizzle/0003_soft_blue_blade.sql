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
ALTER TABLE "customer" ADD COLUMN "compliance" jsonb;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "internal_notes" text;--> statement-breakpoint
ALTER TABLE "customer_audit_log" ADD CONSTRAINT "customer_audit_log_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_audit_log" ADD CONSTRAINT "customer_audit_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_audit_log_customer_id_idx" ON "customer_audit_log" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_audit_log_performed_at_idx" ON "customer_audit_log" USING btree ("performed_at");