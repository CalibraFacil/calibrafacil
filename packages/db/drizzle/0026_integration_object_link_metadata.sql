ALTER TABLE "integration_object_link" ADD COLUMN "remote_entity_type" text;--> statement-breakpoint
ALTER TABLE "integration_object_link" ADD COLUMN "remote_legacy_id" text;--> statement-breakpoint
ALTER TABLE "integration_object_link" ADD COLUMN "remote_version" integer;--> statement-breakpoint
ALTER TABLE "integration_object_link" ADD COLUMN "metadata" jsonb;
