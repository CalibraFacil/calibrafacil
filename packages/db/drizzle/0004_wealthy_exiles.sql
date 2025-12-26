CREATE TABLE "asset" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"name" text NOT NULL,
	"manufacturer" text,
	"model" text,
	"serial_number" text NOT NULL,
	"tag" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"last_calibration_date" timestamp,
	"next_calibration_date" timestamp,
	"comments" text,
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
ALTER TABLE "asset" ADD CONSTRAINT "asset_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_audit_log" ADD CONSTRAINT "asset_audit_log_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_audit_log" ADD CONSTRAINT "asset_audit_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_customer_id_idx" ON "asset" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "asset_status_idx" ON "asset" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_tag_uidx" ON "asset" USING btree ("tag");--> statement-breakpoint
CREATE INDEX "asset_audit_log_asset_id_idx" ON "asset_audit_log" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_audit_log_performed_at_idx" ON "asset_audit_log" USING btree ("performed_at");