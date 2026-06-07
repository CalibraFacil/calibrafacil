-- Normalized catalog of mass composition-build profiles (the lab's available
-- buildup weights by class + nominal). Replaces the byte-identical
-- `compositionProfile: true` block that was copied onto every mass
-- reference_standard.certified_values. Single source of truth, one row per
-- (organization, profile_class, nominal_g), with provenance.
--
-- Additive only: this migration just creates the catalog. The corresponding
-- strip of compositionProfile entries out of reference_standard.certified_values
-- is performed by packages/db/scripts/backfill-mass-composition-profile.mjs
-- (run after this migration), so the migration stays safe/reversible on its own.
CREATE TABLE IF NOT EXISTS "mass_composition_profile" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"profile_key" text NOT NULL,
	"profile_class" text NOT NULL,
	"nominal_g" double precision NOT NULL,
	"nominal" text NOT NULL,
	"value" double precision NOT NULL,
	"uncertainty" double precision NOT NULL,
	"unit" text DEFAULT 'g' NOT NULL,
	"max_error" double precision,
	"drift" double precision,
	"buoyancy" double precision,
	"coverage_factor" double precision,
	"quantity_available" integer,
	"source_standard_id" integer,
	"source_certificate" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "mass_composition_profile" ADD CONSTRAINT "mass_composition_profile_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "mass_composition_profile" ADD CONSTRAINT "mass_composition_profile_source_standard_id_fk" FOREIGN KEY ("source_standard_id") REFERENCES "public"."reference_standard"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mass_composition_profile_org_idx" ON "mass_composition_profile" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mass_composition_profile_class_idx" ON "mass_composition_profile" USING btree ("organization_id","profile_class");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mass_composition_profile_org_class_nominal_uidx" ON "mass_composition_profile" USING btree ("organization_id","profile_class","nominal_g");
