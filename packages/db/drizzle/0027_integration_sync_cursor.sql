CREATE TABLE "integration_sync_cursor" (
	"id" serial PRIMARY KEY NOT NULL,
	"integration_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"cursor_type" text NOT NULL,
	"last_remote_updated_at" timestamp,
	"last_successful_poll_at" timestamp,
	"next_page" integer,
	"state" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_sync_cursor" ADD CONSTRAINT "integration_sync_cursor_integration_id_organization_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."organization_integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_cursor" ADD CONSTRAINT "integration_sync_cursor_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_cursor" ADD CONSTRAINT "integration_sync_cursor_integration_org_fk" FOREIGN KEY ("integration_id","organization_id") REFERENCES "public"."organization_integration"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_sync_cursor_integration_type_uidx" ON "integration_sync_cursor" USING btree ("integration_id","cursor_type");--> statement-breakpoint
CREATE INDEX "integration_sync_cursor_org_type_idx" ON "integration_sync_cursor" USING btree ("organization_id","cursor_type");--> statement-breakpoint
CREATE INDEX "integration_sync_cursor_last_poll_idx" ON "integration_sync_cursor" USING btree ("last_successful_poll_at");
