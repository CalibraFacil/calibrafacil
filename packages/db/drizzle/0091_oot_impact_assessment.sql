CREATE TABLE "oot_impact_assessment" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"nc_id" integer NOT NULL,
	"deviation_summary" text NOT NULL,
	"deviation_magnitude" real,
	"customer_tolerance" real,
	"tolerance_unit" text,
	"affected_from" timestamp,
	"affected_to" timestamp,
	"items" jsonb,
	"conclusion" text,
	"corrective_action_note" text,
	"signed_by" text,
	"signed_at" timestamp,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oot_impact_assessment" ADD CONSTRAINT "oot_impact_assessment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oot_impact_assessment" ADD CONSTRAINT "oot_impact_assessment_nc_id_non_conformance_id_fk" FOREIGN KEY ("nc_id") REFERENCES "public"."non_conformance"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oot_impact_assessment" ADD CONSTRAINT "oot_impact_assessment_signed_by_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oot_impact_assessment" ADD CONSTRAINT "oot_impact_assessment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oot_impact_assessment_organization_id_idx" ON "oot_impact_assessment" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oot_impact_assessment_nc_uidx" ON "oot_impact_assessment" USING btree ("nc_id");
