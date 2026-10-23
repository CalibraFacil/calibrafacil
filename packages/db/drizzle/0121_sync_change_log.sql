-- A commit-ordered change log for the desktop pull (roadmap P2-4b, protocol 3).
-- docs/architecture/sync-change-seq.md is the design and the correctness argument.
--
-- The pull cursor was the row's `updated_at`: the time the row was WRITTEN, not the
-- time its transaction COMMITTED. A transaction that stamped T1 and committed after a
-- reader had already returned a row stamped T2 > T1 was invisible to every later pull,
-- and a hard delete left nothing to pull at all.
--
--   1. sync_change_log: one row per change of a table the desktop mirrors, written by
--      triggers (below) in the writer's own transaction, so a change and its log entry
--      commit or roll back together. `xid` (xid8, the writing transaction) is what makes
--      the log safe to read by position: the pull only serves rows whose xid is below
--      the oldest transaction still in flight (pg_snapshot_xmin), ordered by
--      (xid, seq), so nothing can still appear behind a cursor it was handed. `seq`
--      (bigserial) only breaks ties inside one transaction.
--      organization_id NOT NULL with ON DELETE CASCADE (derived operational data, like
--      sync_applied_event, not evidence); entity_id is a soft reference on purpose (it
--      outlives the row it names: a hard delete is an entry of its own), so there is no
--      composite tenant key; unit_id is the unit an entry is visible in (NULL = the whole
--      laboratory).
--   2. sync_change_log_purge: the newest (xid, seq) the retention purge removed, per
--      laboratory. A desktop whose cursor sorts below it may have missed entries and is
--      told to bootstrap again.
--   3. The functions and the triggers on: asset_type (a global catalog: one entry per
--      laboratory), customer, asset, service, reference_standard (and its certificate
--      documents, which change what the desktop shows of it), environmental_limits,
--      calibration_job, service_order, calibration_method (PUBLISHED rows only: leaving
--      PUBLISHED is a delete) and mass_composition_profile: exactly the entities of the
--      pull and the bootstrap.
--
-- Functions and triggers are not expressible in schema.ts, so the same objects are
-- repeated in sql/schema-extras.sql (used to build new databases); a drift test
-- (packages/db/src/sync-change-log-sql.test.ts) fails when they differ. Idempotent,
-- because this project applies migration DDL by hand and the drizzle bookkeeping table
-- lags behind it. No backfill: a desktop on protocol 3 starts from a bootstrap, whose
-- cursor is the current position.
CREATE TABLE IF NOT EXISTS "sync_change_log" (
  "seq" bigserial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" integer NOT NULL,
  "op" text NOT NULL,
  "unit_id" integer,
  "xid" xid8 DEFAULT pg_current_xact_id() NOT NULL,
  "changed_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "sync_change_log_op_check" CHECK ("sync_change_log"."op" in ('upsert', 'delete'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_change_log_purge" (
  "organization_id" text PRIMARY KEY NOT NULL,
  "purged_through_xid" xid8 NOT NULL,
  "purged_through_seq" bigint NOT NULL,
  "purged_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sync_change_log"
    ADD CONSTRAINT "sync_change_log_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sync_change_log_purge"
    ADD CONSTRAINT "sync_change_log_purge_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_change_log_org_xid_seq_idx"
  ON "sync_change_log" USING btree ("organization_id", "xid", "seq");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_change_log_changed_at_idx"
  ON "sync_change_log" USING btree ("changed_at");
--> statement-breakpoint
-- BEGIN sync change log functions
CREATE OR REPLACE FUNCTION calibra_sync_change_log_append(
  p_organization_id text,
  p_entity_type text,
  p_entity_id integer,
  p_op text,
  p_unit_id integer
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_organization_id IS NULL OR p_entity_id IS NULL THEN
    RETURN;
  END IF;
  -- One entry per (entity, op, unit) per transaction: a transaction that touches a
  -- row five times is one change to the desktop.
  INSERT INTO public.sync_change_log (organization_id, entity_type, entity_id, op, unit_id)
  SELECT p_organization_id, p_entity_type, p_entity_id, p_op, p_unit_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.sync_change_log existing
    WHERE existing.organization_id = p_organization_id
      AND existing.xid = pg_current_xact_id()
      AND existing.entity_type = p_entity_type
      AND existing.entity_id = p_entity_id
      AND existing.op = p_op
      AND existing.unit_id IS NOT DISTINCT FROM p_unit_id
  );
END
$$;

-- The trigger body. TG_ARGV[0] is the entity type the desktop knows the table as.
-- Which column names the laboratory and the unit differs by table, so they are read
-- by table name; a branch for another table is never executed, so never planned.
CREATE OR REPLACE FUNCTION calibra_sync_change_log()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_entity text := TG_ARGV[0];
  v_old_org text;
  v_new_org text;
  v_old_unit integer;
  v_new_unit integer;
  v_old_id integer;
  v_new_id integer;
  v_old_visible boolean := true;
  v_new_visible boolean := true;
BEGIN
  IF TG_TABLE_NAME = 'asset_type' THEN
    -- A global catalog: every laboratory mirrors it, so the change is logged once for each.
    IF TG_OP = 'DELETE' THEN
      v_new_id := OLD.id;
    ELSE
      v_new_id := NEW.id;
    END IF;
    INSERT INTO public.sync_change_log (organization_id, entity_type, entity_id, op, unit_id)
    SELECT o.id, v_entity, v_new_id, CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END, NULL
    FROM public.organization o
    WHERE coalesce(o.type, 'LAB') = 'LAB'
      AND NOT EXISTS (
        SELECT 1 FROM public.sync_change_log existing
        WHERE existing.organization_id = o.id
          AND existing.xid = pg_current_xact_id()
          AND existing.entity_type = v_entity
          AND existing.entity_id = v_new_id
          AND existing.op = CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END
      );
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    CASE TG_TABLE_NAME
      WHEN 'customer' THEN
        v_old_org := OLD.lab_organization_id; v_old_id := OLD.id;
      WHEN 'asset' THEN
        v_old_org := OLD.lab_organization_id; v_old_unit := OLD.unit_id; v_old_id := OLD.id;
      WHEN 'calibration_method' THEN
        v_old_org := OLD.organization_id; v_old_id := OLD.id;
        v_old_visible := OLD.status = 'PUBLISHED';
      WHEN 'mass_composition_profile' THEN
        v_old_org := OLD.organization_id; v_old_id := OLD.id;
      WHEN 'reference_standard_certificate_document' THEN
        v_old_org := OLD.organization_id; v_old_unit := OLD.unit_id; v_old_id := OLD.standard_id;
      ELSE
        v_old_org := OLD.organization_id; v_old_unit := OLD.unit_id; v_old_id := OLD.id;
    END CASE;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    CASE TG_TABLE_NAME
      WHEN 'customer' THEN
        v_new_org := NEW.lab_organization_id; v_new_id := NEW.id;
      WHEN 'asset' THEN
        v_new_org := NEW.lab_organization_id; v_new_unit := NEW.unit_id; v_new_id := NEW.id;
      WHEN 'calibration_method' THEN
        v_new_org := NEW.organization_id; v_new_id := NEW.id;
        v_new_visible := NEW.status = 'PUBLISHED';
      WHEN 'mass_composition_profile' THEN
        v_new_org := NEW.organization_id; v_new_id := NEW.id;
      WHEN 'reference_standard_certificate_document' THEN
        v_new_org := NEW.organization_id; v_new_unit := NEW.unit_id; v_new_id := NEW.standard_id;
      ELSE
        v_new_org := NEW.organization_id; v_new_unit := NEW.unit_id; v_new_id := NEW.id;
    END CASE;
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- A document of a standard changed the standard, it did not make it disappear.
    IF TG_TABLE_NAME = 'reference_standard_certificate_document' THEN
      PERFORM calibra_sync_change_log_append(v_old_org, v_entity, v_old_id, 'upsert', v_old_unit);
    ELSIF v_old_visible THEN
      PERFORM calibra_sync_change_log_append(v_old_org, v_entity, v_old_id, 'delete', v_old_unit);
    END IF;
    RETURN NULL;
  END IF;

  -- INSERT and UPDATE. What the desktop gets is decided when it pulls (an entry only
  -- says "look at this row again, in this unit"), so a row that left a scope (another
  -- unit, no longer published) needs an entry for the scope it left.
  IF v_new_visible THEN
    PERFORM calibra_sync_change_log_append(v_new_org, v_entity, v_new_id, 'upsert', v_new_unit);
  END IF;
  IF TG_OP = 'UPDATE'
     AND v_old_visible
     AND (v_old_org IS DISTINCT FROM v_new_org
          OR v_old_unit IS DISTINCT FROM v_new_unit
          OR v_old_id IS DISTINCT FROM v_new_id
          OR NOT v_new_visible) THEN
    PERFORM calibra_sync_change_log_append(v_old_org, v_entity, v_old_id, 'delete', v_old_unit);
  END IF;
  RETURN NULL;
END
$$;
-- END sync change log functions
--> statement-breakpoint
-- BEGIN sync change log triggers
DROP TRIGGER IF EXISTS sync_change_log_asset_type_write ON public.asset_type;
CREATE TRIGGER sync_change_log_asset_type_write
  AFTER INSERT OR DELETE ON public.asset_type
  FOR EACH ROW EXECUTE FUNCTION calibra_sync_change_log('asset_type');
DROP TRIGGER IF EXISTS sync_change_log_asset_type_update ON public.asset_type;
CREATE TRIGGER sync_change_log_asset_type_update
  AFTER UPDATE ON public.asset_type
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION calibra_sync_change_log('asset_type');
DROP TRIGGER IF EXISTS sync_change_log_customer_write ON public.customer;
CREATE TRIGGER sync_change_log_customer_write
  AFTER INSERT OR DELETE ON public.customer
  FOR EACH ROW EXECUTE FUNCTION calibra_sync_change_log('customer');
DROP TRIGGER IF EXISTS sync_change_log_customer_update ON public.customer;
CREATE TRIGGER sync_change_log_customer_update
  AFTER UPDATE ON public.customer
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION calibra_sync_change_log('customer');
DROP TRIGGER IF EXISTS sync_change_log_asset_write ON public.asset;
CREATE TRIGGER sync_change_log_asset_write
  AFTER INSERT OR DELETE ON public.asset
  FOR EACH ROW EXECUTE FUNCTION calibra_sync_change_log('asset');
DROP TRIGGER IF EXISTS sync_change_log_asset_update ON public.asset;
CREATE TRIGGER sync_change_log_asset_update
  AFTER UPDATE ON public.asset
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION calibra_sync_change_log('asset');
DROP TRIGGER IF EXISTS sync_change_log_service_write ON public.service;
CREATE TRIGGER sync_change_log_service_write
  AFTER INSERT OR DELETE ON public.service
  FOR EACH ROW EXECUTE FUNCTION calibra_sync_change_log('service');
DROP TRIGGER IF EXISTS sync_change_log_service_update ON public.service;
CREATE TRIGGER sync_change_log_service_update
  AFTER UPDATE ON public.service
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION calibra_sync_change_log('service');
DROP TRIGGER IF EXISTS sync_change_log_reference_standard_write ON public.reference_standard;
CREATE TRIGGER sync_change_log_reference_standard_write
  AFTER INSERT OR DELETE ON public.reference_standard
  FOR EACH ROW EXECUTE FUNCTION calibra_sync_change_log('reference_standard');
DROP TRIGGER IF EXISTS sync_change_log_reference_standard_update ON public.reference_standard;
CREATE TRIGGER sync_change_log_reference_standard_update
  AFTER UPDATE ON public.reference_standard
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION calibra_sync_change_log('reference_standard');
DROP TRIGGER IF EXISTS sync_change_log_reference_standard_certificate_document_write ON public.reference_standard_certificate_document;
CREATE TRIGGER sync_change_log_reference_standard_certificate_document_write
  AFTER INSERT OR DELETE ON public.reference_standard_certificate_document
  FOR EACH ROW EXECUTE FUNCTION calibra_sync_change_log('reference_standard');
DROP TRIGGER IF EXISTS sync_change_log_reference_standard_certificate_document_update ON public.reference_standard_certificate_document;
CREATE TRIGGER sync_change_log_reference_standard_certificate_document_update
  AFTER UPDATE ON public.reference_standard_certificate_document
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION calibra_sync_change_log('reference_standard');
DROP TRIGGER IF EXISTS sync_change_log_environmental_limits_write ON public.environmental_limits;
CREATE TRIGGER sync_change_log_environmental_limits_write
  AFTER INSERT OR DELETE ON public.environmental_limits
  FOR EACH ROW EXECUTE FUNCTION calibra_sync_change_log('environmental_limit');
DROP TRIGGER IF EXISTS sync_change_log_environmental_limits_update ON public.environmental_limits;
CREATE TRIGGER sync_change_log_environmental_limits_update
  AFTER UPDATE ON public.environmental_limits
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION calibra_sync_change_log('environmental_limit');
DROP TRIGGER IF EXISTS sync_change_log_calibration_job_write ON public.calibration_job;
CREATE TRIGGER sync_change_log_calibration_job_write
  AFTER INSERT OR DELETE ON public.calibration_job
  FOR EACH ROW EXECUTE FUNCTION calibra_sync_change_log('calibration_job');
DROP TRIGGER IF EXISTS sync_change_log_calibration_job_update ON public.calibration_job;
CREATE TRIGGER sync_change_log_calibration_job_update
  AFTER UPDATE ON public.calibration_job
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION calibra_sync_change_log('calibration_job');
DROP TRIGGER IF EXISTS sync_change_log_service_order_write ON public.service_order;
CREATE TRIGGER sync_change_log_service_order_write
  AFTER INSERT OR DELETE ON public.service_order
  FOR EACH ROW EXECUTE FUNCTION calibra_sync_change_log('service_order');
DROP TRIGGER IF EXISTS sync_change_log_service_order_update ON public.service_order;
CREATE TRIGGER sync_change_log_service_order_update
  AFTER UPDATE ON public.service_order
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION calibra_sync_change_log('service_order');
DROP TRIGGER IF EXISTS sync_change_log_calibration_method_write ON public.calibration_method;
CREATE TRIGGER sync_change_log_calibration_method_write
  AFTER INSERT OR DELETE ON public.calibration_method
  FOR EACH ROW EXECUTE FUNCTION calibra_sync_change_log('published_method');
DROP TRIGGER IF EXISTS sync_change_log_calibration_method_update ON public.calibration_method;
CREATE TRIGGER sync_change_log_calibration_method_update
  AFTER UPDATE ON public.calibration_method
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION calibra_sync_change_log('published_method');
DROP TRIGGER IF EXISTS sync_change_log_mass_composition_profile_write ON public.mass_composition_profile;
CREATE TRIGGER sync_change_log_mass_composition_profile_write
  AFTER INSERT OR DELETE ON public.mass_composition_profile
  FOR EACH ROW EXECUTE FUNCTION calibra_sync_change_log('mass_composition_profile');
DROP TRIGGER IF EXISTS sync_change_log_mass_composition_profile_update ON public.mass_composition_profile;
CREATE TRIGGER sync_change_log_mass_composition_profile_update
  AFTER UPDATE ON public.mass_composition_profile
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION calibra_sync_change_log('mass_composition_profile');
-- END sync change log triggers
