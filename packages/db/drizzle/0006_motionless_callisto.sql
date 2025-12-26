CREATE TABLE "asset_type" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"definition" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "asset_type_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "asset_type_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "specifications" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_type_slug_uidx" ON "asset_type" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_asset_type_id_asset_type_id_fk" FOREIGN KEY ("asset_type_id") REFERENCES "public"."asset_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_type_id_idx" ON "asset" USING btree ("asset_type_id");