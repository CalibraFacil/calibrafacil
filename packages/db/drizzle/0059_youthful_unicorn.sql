CREATE TABLE "service_order_email_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"unit_id" integer,
	"service_order_id" integer NOT NULL,
	"event_key" text NOT NULL,
	"target_status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	CONSTRAINT "service_order_email_outbox_order_event_uidx" UNIQUE("service_order_id","event_key")
);
--> statement-breakpoint
ALTER TABLE "service_order_email_outbox" ADD CONSTRAINT "service_order_email_outbox_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_email_outbox" ADD CONSTRAINT "service_order_email_outbox_service_order_id_service_order_id_fk" FOREIGN KEY ("service_order_id") REFERENCES "public"."service_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_order_email_outbox_pending_idx" ON "service_order_email_outbox" USING btree ("created_at","processed_at");