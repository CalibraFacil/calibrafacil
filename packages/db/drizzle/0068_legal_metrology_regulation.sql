-- Legal-metrology regulation catalog (deferred #3 of issue #423).
--
-- A curated, in-house lookup of legal-metrology Portarias → the default regulated-interval
-- shape, so the lab regime form can auto-fill the regulated fields from a chosen regulation.
-- There is no public Inmetro registry, so rows are seeded in-house WITH provenance
-- (primary = RTM/DOU-confirmed; secondary = needs operator re-confirmation, surfaced as a
-- "(verificar artigo no DOU)" caveat in the UI).
--
-- GLOBAL reference data — NOT tenant-scoped (the same Portarias apply to every lab).
-- `category` is the idempotent natural key the seed conflicts on (ON CONFLICT DO NOTHING).
-- Purely additive; IF NOT EXISTS keeps it safe to re-run on the drizzle meta.
CREATE TABLE IF NOT EXISTS "legal_metrology_regulation" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"kind" text NOT NULL,
	"value_months" integer,
	"by_technology" jsonb,
	"anchor" text,
	"operationalized_by_delegate" boolean DEFAULT false NOT NULL,
	"regulation_reference" text NOT NULL,
	"provenance" text NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "legal_metrology_regulation_category_uidx" ON "legal_metrology_regulation" USING btree ("category");
