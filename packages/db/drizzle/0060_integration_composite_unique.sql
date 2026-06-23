-- Convert organization_integration's composite uniqueness from a UNIQUE INDEX to
-- a UNIQUE CONSTRAINT so drizzle emits it BEFORE the integration_* composite FKs
-- on a cold build (a uniqueIndex is emitted after the FKs, which breaks fresh-DB
-- provisioning via drizzle-kit push/migrate). The 6 composite FKs depend on the
-- old index, so Postgres blocks DROP INDEX until they are dropped; this migration
-- drops them, swaps index -> constraint, and re-adds them (atomic per migration tx).
ALTER TABLE "integration_connection" DROP CONSTRAINT "integration_connection_integration_org_fk";--> statement-breakpoint
ALTER TABLE "integration_event_log" DROP CONSTRAINT "integration_event_log_integration_org_fk";--> statement-breakpoint
ALTER TABLE "integration_object_link" DROP CONSTRAINT "integration_object_link_integration_org_fk";--> statement-breakpoint
ALTER TABLE "integration_sync_run" DROP CONSTRAINT "integration_sync_run_integration_org_fk";--> statement-breakpoint
ALTER TABLE "integration_sync_item" DROP CONSTRAINT "integration_sync_item_integration_org_fk";--> statement-breakpoint
ALTER TABLE "integration_sync_cursor" DROP CONSTRAINT "integration_sync_cursor_integration_org_fk";--> statement-breakpoint
DROP INDEX "organization_integration_id_org_uidx";--> statement-breakpoint
ALTER TABLE "organization_integration" ADD CONSTRAINT "organization_integration_id_org_uidx" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "integration_connection" ADD CONSTRAINT "integration_connection_integration_org_fk" FOREIGN KEY ("integration_id","organization_id") REFERENCES "public"."organization_integration"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_event_log" ADD CONSTRAINT "integration_event_log_integration_org_fk" FOREIGN KEY ("integration_id","organization_id") REFERENCES "public"."organization_integration"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_object_link" ADD CONSTRAINT "integration_object_link_integration_org_fk" FOREIGN KEY ("integration_id","organization_id") REFERENCES "public"."organization_integration"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_run" ADD CONSTRAINT "integration_sync_run_integration_org_fk" FOREIGN KEY ("integration_id","organization_id") REFERENCES "public"."organization_integration"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_item" ADD CONSTRAINT "integration_sync_item_integration_org_fk" FOREIGN KEY ("integration_id","organization_id") REFERENCES "public"."organization_integration"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_cursor" ADD CONSTRAINT "integration_sync_cursor_integration_org_fk" FOREIGN KEY ("integration_id","organization_id") REFERENCES "public"."organization_integration"("id","organization_id") ON DELETE cascade ON UPDATE no action;
