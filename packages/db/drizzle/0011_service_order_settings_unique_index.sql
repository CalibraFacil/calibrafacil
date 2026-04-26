DROP INDEX IF EXISTS "service_order_settings_org_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "service_order_settings_org_uidx" ON "service_order_settings" ("organization_id");
