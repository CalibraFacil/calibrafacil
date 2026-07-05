-- CMP-07 (#692): user self-delete must NOT cascade-wipe regulated ISO/IEC 17025
-- §6.2 records. The subject tables personnel_competence / training_record /
-- authorized_signatory each carry userId -> user.id ON DELETE CASCADE, so a
-- Better Auth deleteUser erased competence, training (incl. its R2 training
-- certificate reference) and authorized-signatory (§6.2.6) history with no trace.
-- The audit-log FKs were already de-cascaded (#691/#697 = migrations 0079/0081),
-- so the audit rows survive — but the SUBJECT rows did not, until this change.
--
-- Fix (Pedro's ratified SOFT-DELETE decision, 2026-07-05): flip the three
-- userId FKs CASCADE -> SET NULL and make the columns NULLABLE. A beforeDelete
-- hook (packages/auth) soft-deletes competences/trainings, revokes signatory
-- authorizations, and writes audit rows with a name/email identity snapshot
-- BEFORE the user row is deleted; SET NULL then lets the user row go while every
-- regulated row survives with user_id NULL.
--
-- Constraint names are the Drizzle convention verified against
-- packages/db/drizzle/0000_late_donald_blake.sql (personnel_competence line 1256,
-- training_record line 1293) and 0047_authorized_signatory.sql line 40 /
-- 0000 line 885 (authorized_signatory). All three are 39 chars or fewer, so the
-- 63-char identifier limit does not truncate them. The operator must re-verify
-- against prod pg_constraint before applying (a manual/renamed constraint would
-- differ). Forward-only and idempotent (drop-if-exists + guarded re-add).
--
-- REWORK (verifier-reproduced defect, same day): personnel_competence and
-- authorized_signatory each also carry a composite
-- UNIQUE (organization_id, user_id, asset_type_id) NULLS NOT DISTINCT
-- constraint/index (competence_org_user_asset_type_uidx /
-- authorized_signatory_org_user_asset_type_uidx — verified against
-- packages/db/drizzle/0000_late_donald_blake.sql line 820 (competence,
-- table CONSTRAINT) and 0047_authorized_signatory.sql line 64 / 0058_dusty_paibok.sql
-- line 73 (signatory, INDEX then CONSTRAINT — both same name, handled by
-- attempting both DROP CONSTRAINT and DROP INDEX below). With ON DELETE SET
-- NULL now live, deleting a SECOND user sharing the same (org, asset_type)
-- scope as an already-tombstoned first user collides on the NULLS-NOT-DISTINCT
-- key (org, NULL, NULL) or (org, NULL, <assetTypeId>) — reproduced as
-- Postgres 23505 aborting the whole delete-user transaction (nothing
-- persists, user becomes undeletable). Fix: make BOTH unique objects
-- PARTIAL (`WHERE user_id IS NOT NULL`) so tombstoned rows (user_id NULL)
-- are exempt from the uniqueness check entirely — any number of them may
-- coexist — while `NULLS NOT DISTINCT` is KEPT for the surviving ACTIVE
-- rows (preserves "one org-wide (asset_type_id NULL) row per user").
--
-- Tool-support note: drizzle-orm@0.45.2's `uniqueIndex()` builder supports
-- `.where()` but not `.nullsNotDistinct()`, and `unique()` supports
-- `.nullsNotDistinct()` but not `.where()` — neither builder can express a
-- partial + nulls-not-distinct index, and drizzle-kit@0.31.7's SQL generator
-- only ever emits "NULLS NOT DISTINCT" for `ADD CONSTRAINT ... UNIQUE`, never
-- for `CREATE INDEX` (confirmed by reading the installed packages: grep for
-- "NULLS NOT DISTINCT" across drizzle-kit's compiled output only matches the
-- ADD CONSTRAINT code paths). schema.ts therefore declares an approximate
-- `uniqueIndex(...).where(...)` (no nulls-not-distinct) for drizzle-kit's
-- benefit; this migration (prod/dev) and
-- apps/api/test/integration/extensions.sql (test harness, applied once after
-- `drizzle-kit push` builds the per-run template DB) both lay down the TRUE
-- partial + nulls-not-distinct DDL on top.

-- personnel_competence.user_id: CASCADE -> SET NULL, nullable
ALTER TABLE "personnel_competence" DROP CONSTRAINT IF EXISTS "personnel_competence_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "personnel_competence" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "personnel_competence" ADD CONSTRAINT "personnel_competence_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- training_record.user_id: CASCADE -> SET NULL, nullable
ALTER TABLE "training_record" DROP CONSTRAINT IF EXISTS "training_record_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "training_record" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "training_record" ADD CONSTRAINT "training_record_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- authorized_signatory.user_id: CASCADE -> SET NULL, nullable
ALTER TABLE "authorized_signatory" DROP CONSTRAINT IF EXISTS "authorized_signatory_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "authorized_signatory" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "authorized_signatory" ADD CONSTRAINT "authorized_signatory_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- personnel_competence: composite unique -> PARTIAL (tombstones exempt),
-- NULLS NOT DISTINCT kept for ACTIVE (user_id IS NOT NULL) rows.
ALTER TABLE "personnel_competence" DROP CONSTRAINT IF EXISTS "competence_org_user_asset_type_uidx";--> statement-breakpoint
DROP INDEX IF EXISTS "competence_org_user_asset_type_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "competence_org_user_asset_type_uidx" ON "personnel_competence" USING btree ("organization_id","user_id","asset_type_id") NULLS NOT DISTINCT WHERE "user_id" IS NOT NULL;--> statement-breakpoint

-- authorized_signatory: composite unique -> PARTIAL (tombstones exempt),
-- NULLS NOT DISTINCT kept for ACTIVE (user_id IS NOT NULL) rows.
ALTER TABLE "authorized_signatory" DROP CONSTRAINT IF EXISTS "authorized_signatory_org_user_asset_type_uidx";--> statement-breakpoint
DROP INDEX IF EXISTS "authorized_signatory_org_user_asset_type_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "authorized_signatory_org_user_asset_type_uidx" ON "authorized_signatory" USING btree ("organization_id","user_id","asset_type_id") NULLS NOT DISTINCT WHERE "user_id" IS NOT NULL;
