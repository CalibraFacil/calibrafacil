CREATE TABLE "service" (
	"id" serial PRIMARY KEY NOT NULL,
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
ALTER TABLE "service" ADD CONSTRAINT "service_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service" ADD CONSTRAINT "service_method_id_calibration_method_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."calibration_method"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service" ADD CONSTRAINT "service_asset_type_id_asset_type_id_fk" FOREIGN KEY ("asset_type_id") REFERENCES "public"."asset_type"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_audit_log" ADD CONSTRAINT "service_audit_log_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_audit_log" ADD CONSTRAINT "service_audit_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_organization_id_idx" ON "service" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "service_method_id_idx" ON "service" USING btree ("method_id");--> statement-breakpoint
CREATE INDEX "service_asset_type_id_idx" ON "service" USING btree ("asset_type_id");--> statement-breakpoint
CREATE INDEX "service_is_active_idx" ON "service" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "service_audit_log_service_id_idx" ON "service_audit_log" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "service_audit_log_performed_at_idx" ON "service_audit_log" USING btree ("performed_at");