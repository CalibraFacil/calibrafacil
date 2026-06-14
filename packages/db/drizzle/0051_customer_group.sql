CREATE TABLE IF NOT EXISTS "customer_group" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"auth_organization_id" text NOT NULL,
	"lab_organization_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "group_id" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customer_group" ADD CONSTRAINT "customer_group_auth_organization_id_organization_id_fk" FOREIGN KEY ("auth_organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customer_group" ADD CONSTRAINT "customer_group_lab_organization_id_organization_id_fk" FOREIGN KEY ("lab_organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customer" ADD CONSTRAINT "customer_group_id_customer_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."customer_group"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_group_auth_org_id_idx" ON "customer_group" USING btree ("auth_organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_group_lab_org_id_idx" ON "customer_group" USING btree ("lab_organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_group_id_idx" ON "customer" USING btree ("group_id");
