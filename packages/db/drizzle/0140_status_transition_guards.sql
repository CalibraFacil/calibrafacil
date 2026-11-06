-- Every lifecycle status column enforced in Postgres, generated from its state
-- machine (packages/schemas/src/machines, docs/implicit-state-machines.md).
--
-- calibration_job.status was the only column whose transitions were declared
-- once and enforced by the database (migrations 0119/0139). The other status
-- columns were text with a TypeScript union: any UPDATE could write any value
-- and any move. Their lifecycles are now tables in @calibra-facil/schemas
-- (`defineStateMachine`), every writer names a command of its table, and this
-- migration adds one BEFORE INSERT OR UPDATE OF <column> trigger per column:
--
--   * UPDATE: a change of the column must be a move of the machine; rewriting
--     the same value is always allowed. Anything else raises
--     'calibra: illegal <machine> transition A -> B', SQLSTATE CF001.
--   * INSERT: only the states the machine creates rows in.
--   * Hatches, as the job guard: `SET LOCAL calibra.allow_status_repair = 'on'`
--     (an audited repair) or the seed/purge `calibra.allow_audit_rewrite`, both
--     for a session of the table owner only (calibra_history_rewrite_allowed /
--     the repair setting).
--
-- Existing rows are not re-validated: a row already in a state a machine would
-- not produce does not block this migration; the triggers check status writes
-- going forward.
--
-- The functions between the BEGIN/END markers are GENERATED
-- (`pnpm --filter @calibra-facil/db gen:status-guards-sql`); a drift guard
-- (packages/db/src/status-guard-sql.test.ts) fails when a block here, or its
-- copy in sql/schema-extras.sql, differs from what the current machine
-- generates. When a machine changes, ship a NEW migration that redefines its
-- function; do not edit this one.

-- BEGIN generated: calibra_service_order_status_guard
CREATE OR REPLACE FUNCTION calibra_service_order_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('opened', 'awaiting_tech_evaluation', 'warranty_return') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal service order creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A service order is created in opened, awaiting_tech_evaluation, warranty_return.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('opened', 'awaiting_tech_evaluation'),
    ('opened', 'canceled'),
    ('awaiting_tech_evaluation', 'under_evaluation'),
    ('awaiting_tech_evaluation', 'canceled'),
    ('under_evaluation', 'awaiting_quote_approval'),
    ('under_evaluation', 'awaiting_calibration'),
    ('under_evaluation', 'awaiting_final_review'),
    ('under_evaluation', 'ready_for_pickup'),
    ('under_evaluation', 'canceled'),
    ('awaiting_quote_approval', 'quote_approved'),
    ('awaiting_quote_approval', 'quote_rejected'),
    ('awaiting_quote_approval', 'canceled'),
    ('quote_approved', 'repair_in_progress'),
    ('quote_approved', 'awaiting_calibration'),
    ('quote_rejected', 'ready_for_pickup'),
    ('quote_rejected', 'canceled'),
    ('repair_in_progress', 'awaiting_calibration'),
    ('repair_in_progress', 'awaiting_final_review'),
    ('awaiting_calibration', 'calibration_in_progress'),
    ('awaiting_calibration', 'awaiting_final_review'),
    ('calibration_in_progress', 'awaiting_final_review'),
    ('awaiting_final_review', 'ready_for_pickup'),
    ('ready_for_pickup', 'delivered'),
    ('delivered', 'closed'),
    ('warranty_return', 'awaiting_tech_evaluation'),
    ('warranty_return', 'under_evaluation'),
    ('warranty_return', 'canceled'),
    ('opened', 'awaiting_quote_approval'),
    ('opened', 'awaiting_calibration'),
    ('opened', 'ready_for_pickup'),
    ('awaiting_tech_evaluation', 'awaiting_quote_approval'),
    ('awaiting_tech_evaluation', 'awaiting_calibration'),
    ('awaiting_tech_evaluation', 'ready_for_pickup'),
    ('warranty_return', 'awaiting_quote_approval'),
    ('warranty_return', 'awaiting_calibration'),
    ('warranty_return', 'ready_for_pickup'),
    ('quote_approved', 'awaiting_quote_approval'),
    ('quote_rejected', 'awaiting_quote_approval'),
    ('ready_for_pickup', 'awaiting_quote_approval'),
    ('delivered', 'awaiting_quote_approval'),
    ('closed', 'delivered'),
    ('closed', 'awaiting_tech_evaluation'),
    ('canceled', 'opened'),
    ('canceled', 'awaiting_tech_evaluation'),
    ('canceled', 'under_evaluation'),
    ('canceled', 'awaiting_quote_approval'),
    ('canceled', 'quote_rejected'),
    ('canceled', 'warranty_return')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal service order transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the service order with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_service_order_status_guard

DROP TRIGGER IF EXISTS service_order_status_transition_guard ON public.service_order;
CREATE TRIGGER service_order_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.service_order
  FOR EACH ROW EXECUTE FUNCTION calibra_service_order_status_guard();

-- BEGIN generated: calibra_service_order_quote_status_guard
CREATE OR REPLACE FUNCTION calibra_service_order_quote_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('draft') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal service order quote creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A service order quote is created in draft.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('draft', 'sent'),
    ('sent', 'approved'),
    ('sent', 'rejected')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal service order quote transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the service order quote with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_service_order_quote_status_guard

DROP TRIGGER IF EXISTS service_order_quote_status_transition_guard ON public.service_order_quote;
CREATE TRIGGER service_order_quote_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.service_order_quote
  FOR EACH ROW EXECUTE FUNCTION calibra_service_order_quote_status_guard();

-- BEGIN generated: calibra_calibration_visit_status_guard
CREATE OR REPLACE FUNCTION calibra_calibration_visit_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('PROPOSED', 'CONFIRMED') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal calibration visit creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A calibration visit is created in PROPOSED, CONFIRMED.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('PROPOSED', 'CONFIRMED'),
    ('PROPOSED', 'IN_PROGRESS'),
    ('CONFIRMED', 'IN_PROGRESS'),
    ('PROPOSED', 'COMPLETED'),
    ('CONFIRMED', 'COMPLETED'),
    ('IN_PROGRESS', 'COMPLETED'),
    ('PROPOSED', 'CANCELLED'),
    ('CONFIRMED', 'CANCELLED'),
    ('IN_PROGRESS', 'CANCELLED')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal calibration visit transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the calibration visit with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_calibration_visit_status_guard

DROP TRIGGER IF EXISTS calibration_visit_status_transition_guard ON public.calibration_visit;
CREATE TRIGGER calibration_visit_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.calibration_visit
  FOR EACH ROW EXECUTE FUNCTION calibra_calibration_visit_status_guard();

-- BEGIN generated: calibra_visit_reschedule_request_status_guard
CREATE OR REPLACE FUNCTION calibra_visit_reschedule_request_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('PENDING') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal visit reschedule request creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A visit reschedule request is created in PENDING.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('PENDING', 'ACCEPTED'),
    ('PENDING', 'DECLINED'),
    ('PENDING', 'SUPERSEDED')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal visit reschedule request transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the visit reschedule request with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_visit_reschedule_request_status_guard

DROP TRIGGER IF EXISTS visit_reschedule_request_status_transition_guard ON public.visit_reschedule_request;
CREATE TRIGGER visit_reschedule_request_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.visit_reschedule_request
  FOR EACH ROW EXECUTE FUNCTION calibra_visit_reschedule_request_status_guard();

-- BEGIN generated: calibra_calibration_request_status_guard
CREATE OR REPLACE FUNCTION calibra_calibration_request_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('PENDING') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal calibration request creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A calibration request is created in PENDING.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('PENDING', 'UNDER_REVIEW'),
    ('PENDING', 'APPROVED'),
    ('UNDER_REVIEW', 'APPROVED'),
    ('PENDING', 'REJECTED'),
    ('UNDER_REVIEW', 'REJECTED'),
    ('APPROVED', 'REJECTED'),
    ('APPROVED', 'CONVERTED')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal calibration request transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the calibration request with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_calibration_request_status_guard

DROP TRIGGER IF EXISTS calibration_request_status_transition_guard ON public.calibration_request;
CREATE TRIGGER calibration_request_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.calibration_request
  FOR EACH ROW EXECUTE FUNCTION calibra_calibration_request_status_guard();

-- BEGIN generated: calibra_calibration_method_status_guard
CREATE OR REPLACE FUNCTION calibra_calibration_method_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('DRAFT') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal calibration method creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A calibration method is created in DRAFT.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('DRAFT', 'PENDING_APPROVAL'),
    ('PENDING_APPROVAL', 'TECHNICAL_REVIEWED'),
    ('TECHNICAL_REVIEWED', 'PUBLISHED'),
    ('PUBLISHED', 'ARCHIVED'),
    ('PENDING_APPROVAL', 'DRAFT'),
    ('TECHNICAL_REVIEWED', 'DRAFT')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal calibration method transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the calibration method with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_calibration_method_status_guard

DROP TRIGGER IF EXISTS calibration_method_status_transition_guard ON public.calibration_method;
CREATE TRIGGER calibration_method_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.calibration_method
  FOR EACH ROW EXECUTE FUNCTION calibra_calibration_method_status_guard();

-- BEGIN generated: calibra_asset_status_guard
CREATE OR REPLACE FUNCTION calibra_asset_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('ACTIVE', 'INACTIVE', 'MAINTENANCE', 'SCRAPPED') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal asset creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A asset is created in ACTIVE, INACTIVE, MAINTENANCE, SCRAPPED.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('ACTIVE', 'INACTIVE'),
    ('ACTIVE', 'MAINTENANCE'),
    ('ACTIVE', 'SCRAPPED'),
    ('INACTIVE', 'ACTIVE'),
    ('INACTIVE', 'MAINTENANCE'),
    ('INACTIVE', 'SCRAPPED'),
    ('MAINTENANCE', 'ACTIVE'),
    ('MAINTENANCE', 'INACTIVE'),
    ('MAINTENANCE', 'SCRAPPED'),
    ('SCRAPPED', 'ACTIVE'),
    ('SCRAPPED', 'INACTIVE'),
    ('SCRAPPED', 'MAINTENANCE')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal asset transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the asset with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_asset_status_guard

DROP TRIGGER IF EXISTS asset_status_transition_guard ON public.asset;
CREATE TRIGGER asset_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.asset
  FOR EACH ROW EXECUTE FUNCTION calibra_asset_status_guard();

-- BEGIN generated: calibra_reference_standard_status_guard
CREATE OR REPLACE FUNCTION calibra_reference_standard_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('ACTIVE', 'INACTIVE', 'OUT_OF_TOLERANCE', 'SENT_FOR_CALIBRATION') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal reference standard creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A reference standard is created in ACTIVE, INACTIVE, OUT_OF_TOLERANCE, SENT_FOR_CALIBRATION.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('ACTIVE', 'INACTIVE'),
    ('ACTIVE', 'OUT_OF_TOLERANCE'),
    ('ACTIVE', 'SENT_FOR_CALIBRATION'),
    ('INACTIVE', 'ACTIVE'),
    ('INACTIVE', 'OUT_OF_TOLERANCE'),
    ('INACTIVE', 'SENT_FOR_CALIBRATION'),
    ('OUT_OF_TOLERANCE', 'INACTIVE'),
    ('OUT_OF_TOLERANCE', 'SENT_FOR_CALIBRATION'),
    ('SENT_FOR_CALIBRATION', 'INACTIVE'),
    ('SENT_FOR_CALIBRATION', 'OUT_OF_TOLERANCE'),
    ('OUT_OF_TOLERANCE', 'ACTIVE'),
    ('SENT_FOR_CALIBRATION', 'ACTIVE')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal reference standard transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the reference standard with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_reference_standard_status_guard

DROP TRIGGER IF EXISTS reference_standard_status_transition_guard ON public.reference_standard;
CREATE TRIGGER reference_standard_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.reference_standard
  FOR EACH ROW EXECUTE FUNCTION calibra_reference_standard_status_guard();

-- BEGIN generated: calibra_mass_composition_profile_status_guard
CREATE OR REPLACE FUNCTION calibra_mass_composition_profile_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('ACTIVE') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal mass composition profile creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A mass composition profile is created in ACTIVE.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('INACTIVE', 'ACTIVE'),
    ('ACTIVE', 'INACTIVE')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal mass composition profile transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the mass composition profile with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_mass_composition_profile_status_guard

DROP TRIGGER IF EXISTS mass_composition_profile_status_transition_guard ON public.mass_composition_profile;
CREATE TRIGGER mass_composition_profile_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.mass_composition_profile
  FOR EACH ROW EXECUTE FUNCTION calibra_mass_composition_profile_status_guard();

-- BEGIN generated: calibra_corrective_action_status_guard
CREATE OR REPLACE FUNCTION calibra_corrective_action_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('OPEN') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal corrective action creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A corrective action is created in OPEN.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('OPEN', 'INVESTIGATION'),
    ('OPEN', 'IMPLEMENTATION'),
    ('INVESTIGATION', 'IMPLEMENTATION'),
    ('IMPLEMENTATION', 'VERIFICATION'),
    ('VERIFICATION', 'CLOSED')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal corrective action transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the corrective action with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_corrective_action_status_guard

DROP TRIGGER IF EXISTS corrective_action_status_transition_guard ON public.corrective_action;
CREATE TRIGGER corrective_action_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.corrective_action
  FOR EACH ROW EXECUTE FUNCTION calibra_corrective_action_status_guard();

-- BEGIN generated: calibra_non_conformance_status_guard
CREATE OR REPLACE FUNCTION calibra_non_conformance_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('open') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal nonconformance creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A nonconformance is created in open.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('open', 'under_review'),
    ('open', 'resolved'),
    ('under_review', 'resolved')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal nonconformance transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the nonconformance with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_non_conformance_status_guard

DROP TRIGGER IF EXISTS non_conformance_status_transition_guard ON public.non_conformance;
CREATE TRIGGER non_conformance_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.non_conformance
  FOR EACH ROW EXECUTE FUNCTION calibra_non_conformance_status_guard();

-- BEGIN generated: calibra_standard_recall_status_guard
CREATE OR REPLACE FUNCTION calibra_standard_recall_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('DRAFT') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal standard recall creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A standard recall is created in DRAFT.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('DRAFT', 'SENT')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal standard recall transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the standard recall with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_standard_recall_status_guard

DROP TRIGGER IF EXISTS standard_recall_status_transition_guard ON public.standard_recall;
CREATE TRIGGER standard_recall_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.standard_recall
  FOR EACH ROW EXECUTE FUNCTION calibra_standard_recall_status_guard();

-- BEGIN generated: calibra_oot_notification_status_guard
CREATE OR REPLACE FUNCTION calibra_oot_notification_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('PENDING') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal out-of-tolerance notification creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A out-of-tolerance notification is created in PENDING.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('PENDING', 'GENERATED'),
    ('GENERATED', 'SENT'),
    ('PENDING', 'ACKNOWLEDGED'),
    ('GENERATED', 'ACKNOWLEDGED'),
    ('SENT', 'ACKNOWLEDGED')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal out-of-tolerance notification transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the out-of-tolerance notification with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_oot_notification_status_guard

DROP TRIGGER IF EXISTS oot_notification_status_transition_guard ON public.oot_notification;
CREATE TRIGGER oot_notification_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.oot_notification
  FOR EACH ROW EXECUTE FUNCTION calibra_oot_notification_status_guard();

-- BEGIN generated: calibra_asset_oot_event_status_guard
CREATE OR REPLACE FUNCTION calibra_asset_oot_event_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('OPEN') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal asset out-of-tolerance event creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A asset out-of-tolerance event is created in OPEN.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('OPEN', 'ASSESSED')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal asset out-of-tolerance event transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the asset out-of-tolerance event with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_asset_oot_event_status_guard

DROP TRIGGER IF EXISTS asset_oot_event_status_transition_guard ON public.asset_oot_event;
CREATE TRIGGER asset_oot_event_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.asset_oot_event
  FOR EACH ROW EXECUTE FUNCTION calibra_asset_oot_event_status_guard();

-- BEGIN generated: calibra_personnel_competence_status_guard
CREATE OR REPLACE FUNCTION calibra_personnel_competence_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('REQUESTED') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal personnel competence creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A personnel competence is created in REQUESTED.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('REQUESTED', 'TRAINING_ASSIGNED'),
    ('PENDING_EVALUATION', 'TRAINING_ASSIGNED'),
    ('TRAINING_ASSIGNED', 'IN_TRAINING'),
    ('IN_TRAINING', 'PENDING_EVALUATION'),
    ('PENDING_EVALUATION', 'ACTIVE'),
    ('REQUESTED', 'CANCELLED'),
    ('TRAINING_ASSIGNED', 'CANCELLED'),
    ('IN_TRAINING', 'CANCELLED'),
    ('PENDING_EVALUATION', 'CANCELLED'),
    ('ACTIVE', 'SUSPENDED'),
    ('EXPIRED', 'ACTIVE'),
    ('SUSPENDED', 'ACTIVE'),
    ('ACTIVE', 'EXPIRED')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal personnel competence transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the personnel competence with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_personnel_competence_status_guard

DROP TRIGGER IF EXISTS personnel_competence_status_transition_guard ON public.personnel_competence;
CREATE TRIGGER personnel_competence_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.personnel_competence
  FOR EACH ROW EXECUTE FUNCTION calibra_personnel_competence_status_guard();

-- BEGIN generated: calibra_training_record_status_guard
CREATE OR REPLACE FUNCTION calibra_training_record_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('planned') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal training record creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A training record is created in planned.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('planned', 'in_progress'),
    ('planned', 'completed'),
    ('planned', 'failed'),
    ('in_progress', 'planned'),
    ('in_progress', 'completed'),
    ('in_progress', 'failed'),
    ('completed', 'planned'),
    ('completed', 'in_progress'),
    ('completed', 'failed'),
    ('failed', 'planned'),
    ('failed', 'in_progress'),
    ('failed', 'completed')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal training record transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the training record with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_training_record_status_guard

DROP TRIGGER IF EXISTS training_record_status_transition_guard ON public.training_record;
CREATE TRIGGER training_record_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.training_record
  FOR EACH ROW EXECUTE FUNCTION calibra_training_record_status_guard();

-- BEGIN generated: calibra_authorized_signatory_status_guard
CREATE OR REPLACE FUNCTION calibra_authorized_signatory_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('ACTIVE') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal authorized signatory creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A authorized signatory is created in ACTIVE.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('ACTIVE', 'REVOKED')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal authorized signatory transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the authorized signatory with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_authorized_signatory_status_guard

DROP TRIGGER IF EXISTS authorized_signatory_status_transition_guard ON public.authorized_signatory;
CREATE TRIGGER authorized_signatory_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.authorized_signatory
  FOR EACH ROW EXECUTE FUNCTION calibra_authorized_signatory_status_guard();

-- BEGIN generated: calibra_proficiency_test_overall_status_guard
CREATE OR REPLACE FUNCTION calibra_proficiency_test_overall_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.overall_status IN ('pending') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal proficiency test creation overall_status %', NEW.overall_status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'overall_status',
            HINT = 'A proficiency test is created in pending.';
  END IF;

  IF NEW.overall_status IS NOT DISTINCT FROM OLD.overall_status THEN
    RETURN NEW;
  END IF;

  IF (OLD.overall_status, NEW.overall_status) IN (
    ('pending', 'satisfactory'),
    ('pending', 'questionable'),
    ('pending', 'unsatisfactory'),
    ('satisfactory', 'questionable'),
    ('satisfactory', 'unsatisfactory'),
    ('questionable', 'satisfactory'),
    ('questionable', 'unsatisfactory'),
    ('unsatisfactory', 'satisfactory'),
    ('unsatisfactory', 'questionable')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal proficiency test transition % -> %', OLD.overall_status, NEW.overall_status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'overall_status',
          HINT = 'Move the proficiency test with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_proficiency_test_overall_status_guard

DROP TRIGGER IF EXISTS proficiency_test_overall_status_transition_guard ON public.proficiency_test;
CREATE TRIGGER proficiency_test_overall_status_transition_guard
  BEFORE INSERT OR UPDATE OF overall_status ON public.proficiency_test
  FOR EACH ROW EXECUTE FUNCTION calibra_proficiency_test_overall_status_guard();

-- BEGIN generated: calibra_control_chart_status_guard
CREATE OR REPLACE FUNCTION calibra_control_chart_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('insufficient_data') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal control chart creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A control chart is created in insufficient_data.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('insufficient_data', 'in_control'),
    ('insufficient_data', 'trending'),
    ('insufficient_data', 'out_of_control'),
    ('in_control', 'insufficient_data'),
    ('in_control', 'trending'),
    ('in_control', 'out_of_control'),
    ('trending', 'insufficient_data'),
    ('trending', 'in_control'),
    ('trending', 'out_of_control'),
    ('out_of_control', 'insufficient_data'),
    ('out_of_control', 'in_control'),
    ('out_of_control', 'trending')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal control chart transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the control chart with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_control_chart_status_guard

DROP TRIGGER IF EXISTS control_chart_status_transition_guard ON public.control_chart;
CREATE TRIGGER control_chart_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.control_chart
  FOR EACH ROW EXECUTE FUNCTION calibra_control_chart_status_guard();

-- BEGIN generated: calibra_certificate_release_status_guard
CREATE OR REPLACE FUNCTION calibra_certificate_release_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('HELD_FOR_BILLING', 'HELD_FOR_PAYMENT', 'RELEASED', 'RELEASED_BY_EXCEPTION') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal certificate release creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A certificate release is created in HELD_FOR_BILLING, HELD_FOR_PAYMENT, RELEASED, RELEASED_BY_EXCEPTION.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('HELD_FOR_BILLING', 'HELD_FOR_PAYMENT'),
    ('HELD_FOR_BILLING', 'RELEASED'),
    ('HELD_FOR_PAYMENT', 'HELD_FOR_BILLING'),
    ('HELD_FOR_PAYMENT', 'RELEASED'),
    ('RELEASED', 'HELD_FOR_BILLING'),
    ('RELEASED', 'HELD_FOR_PAYMENT'),
    ('HELD_FOR_BILLING', 'RELEASED_BY_EXCEPTION'),
    ('HELD_FOR_PAYMENT', 'RELEASED_BY_EXCEPTION'),
    ('RELEASED', 'RELEASED_BY_EXCEPTION')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal certificate release transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the certificate release with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_certificate_release_status_guard

DROP TRIGGER IF EXISTS certificate_release_status_transition_guard ON public.certificate_release;
CREATE TRIGGER certificate_release_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.certificate_release
  FOR EACH ROW EXECUTE FUNCTION calibra_certificate_release_status_guard();

-- BEGIN generated: calibra_commercial_agreement_status_guard
CREATE OR REPLACE FUNCTION calibra_commercial_agreement_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('DRAFT') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal commercial agreement creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A commercial agreement is created in DRAFT.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('DRAFT', 'ACTIVE'),
    ('DRAFT', 'EXPIRED'),
    ('DRAFT', 'CANCELED'),
    ('ACTIVE', 'DRAFT'),
    ('ACTIVE', 'EXPIRED'),
    ('ACTIVE', 'CANCELED'),
    ('EXPIRED', 'DRAFT'),
    ('EXPIRED', 'ACTIVE'),
    ('EXPIRED', 'CANCELED'),
    ('CANCELED', 'DRAFT'),
    ('CANCELED', 'ACTIVE'),
    ('CANCELED', 'EXPIRED')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal commercial agreement transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the commercial agreement with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_commercial_agreement_status_guard

DROP TRIGGER IF EXISTS commercial_agreement_status_transition_guard ON public.commercial_agreement;
CREATE TRIGGER commercial_agreement_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.commercial_agreement
  FOR EACH ROW EXECUTE FUNCTION calibra_commercial_agreement_status_guard();

-- BEGIN generated: calibra_billing_document_status_guard
CREATE OR REPLACE FUNCTION calibra_billing_document_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('DRAFT', 'ISSUED') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal billing document creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A billing document is created in DRAFT, ISSUED.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('DRAFT', 'ISSUED'),
    ('DRAFT', 'PAID'),
    ('ISSUED', 'PAID'),
    ('OVERDUE', 'PAID'),
    ('DRAFT', 'VOID'),
    ('ISSUED', 'VOID'),
    ('PAID', 'VOID'),
    ('OVERDUE', 'VOID'),
    ('DRAFT', 'OVERDUE'),
    ('ISSUED', 'OVERDUE'),
    ('PAID', 'ISSUED'),
    ('PAID', 'OVERDUE'),
    ('OVERDUE', 'ISSUED')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal billing document transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the billing document with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_billing_document_status_guard

DROP TRIGGER IF EXISTS billing_document_status_transition_guard ON public.billing_document;
CREATE TRIGGER billing_document_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.billing_document
  FOR EACH ROW EXECUTE FUNCTION calibra_billing_document_status_guard();

-- BEGIN generated: calibra_billing_document_export_status_guard
CREATE OR REPLACE FUNCTION calibra_billing_document_export_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.export_status IN ('NOT_EXPORTED') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal billing document export creation export_status %', NEW.export_status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'export_status',
            HINT = 'A billing document export is created in NOT_EXPORTED.';
  END IF;

  IF NEW.export_status IS NOT DISTINCT FROM OLD.export_status THEN
    RETURN NEW;
  END IF;

  IF (OLD.export_status, NEW.export_status) IN (
    ('NOT_EXPORTED', 'EXPORTED'),
    ('FAILED', 'EXPORTED'),
    ('NOT_EXPORTED', 'FAILED'),
    ('EXPORTED', 'FAILED')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal billing document export transition % -> %', OLD.export_status, NEW.export_status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'export_status',
          HINT = 'Move the billing document export with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_billing_document_export_status_guard

DROP TRIGGER IF EXISTS billing_document_export_status_transition_guard ON public.billing_document;
CREATE TRIGGER billing_document_export_status_transition_guard
  BEFORE INSERT OR UPDATE OF export_status ON public.billing_document
  FOR EACH ROW EXECUTE FUNCTION calibra_billing_document_export_status_guard();

-- BEGIN generated: calibra_receivable_installment_status_guard
CREATE OR REPLACE FUNCTION calibra_receivable_installment_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('OPEN') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal receivable installment creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A receivable installment is created in OPEN.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('OPEN', 'PAID'),
    ('OVERDUE', 'PAID'),
    ('OPEN', 'VOID'),
    ('PAID', 'VOID'),
    ('OVERDUE', 'VOID'),
    ('OPEN', 'OVERDUE'),
    ('PAID', 'OPEN'),
    ('PAID', 'OVERDUE'),
    ('OVERDUE', 'OPEN'),
    ('VOID', 'OPEN'),
    ('VOID', 'PAID'),
    ('VOID', 'OVERDUE')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal receivable installment transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the receivable installment with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_receivable_installment_status_guard

DROP TRIGGER IF EXISTS receivable_installment_status_transition_guard ON public.receivable_installment;
CREATE TRIGGER receivable_installment_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.receivable_installment
  FOR EACH ROW EXECUTE FUNCTION calibra_receivable_installment_status_guard();

-- BEGIN generated: calibra_organization_integration_status_guard
CREATE OR REPLACE FUNCTION calibra_organization_integration_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('ACTIVE') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal integration creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A integration is created in ACTIVE.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('DISABLED', 'ACTIVE'),
    ('ACTION_REQUIRED', 'ACTIVE'),
    ('ACTIVE', 'ACTION_REQUIRED'),
    ('DISABLED', 'ACTION_REQUIRED'),
    ('ACTIVE', 'DISABLED'),
    ('ACTION_REQUIRED', 'DISABLED')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal integration transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the integration with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_organization_integration_status_guard

DROP TRIGGER IF EXISTS organization_integration_status_transition_guard ON public.organization_integration;
CREATE TRIGGER organization_integration_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.organization_integration
  FOR EACH ROW EXECUTE FUNCTION calibra_organization_integration_status_guard();

-- BEGIN generated: calibra_integration_sync_run_status_guard
CREATE OR REPLACE FUNCTION calibra_integration_sync_run_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('PENDING') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal integration sync run creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A integration sync run is created in PENDING.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('PENDING', 'RUNNING'),
    ('RUNNING', 'COMPLETED'),
    ('RUNNING', 'PARTIAL'),
    ('RUNNING', 'FAILED'),
    ('PENDING', 'FAILED')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal integration sync run transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the integration sync run with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_integration_sync_run_status_guard

DROP TRIGGER IF EXISTS integration_sync_run_status_transition_guard ON public.integration_sync_run;
CREATE TRIGGER integration_sync_run_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.integration_sync_run
  FOR EACH ROW EXECUTE FUNCTION calibra_integration_sync_run_status_guard();

-- BEGIN generated: calibra_integration_sync_item_status_guard
CREATE OR REPLACE FUNCTION calibra_integration_sync_item_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('RUNNING') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal integration sync item creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A integration sync item is created in RUNNING.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('RUNNING', 'SUCCEEDED'),
    ('RUNNING', 'FAILED'),
    ('RUNNING', 'DEAD_LETTER')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal integration sync item transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the integration sync item with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_integration_sync_item_status_guard

DROP TRIGGER IF EXISTS integration_sync_item_status_transition_guard ON public.integration_sync_item;
CREATE TRIGGER integration_sync_item_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.integration_sync_item
  FOR EACH ROW EXECUTE FUNCTION calibra_integration_sync_item_status_guard();

-- BEGIN generated: calibra_public_api_webhook_subscription_status_guard
CREATE OR REPLACE FUNCTION calibra_public_api_webhook_subscription_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('ACTIVE', 'INACTIVE') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal webhook subscription creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A webhook subscription is created in ACTIVE, INACTIVE.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('ACTIVE', 'INACTIVE'),
    ('INACTIVE', 'ACTIVE')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal webhook subscription transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the webhook subscription with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_public_api_webhook_subscription_status_guard

DROP TRIGGER IF EXISTS public_api_webhook_subscription_status_transition_guard ON public.public_api_webhook_subscription;
CREATE TRIGGER public_api_webhook_subscription_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.public_api_webhook_subscription
  FOR EACH ROW EXECUTE FUNCTION calibra_public_api_webhook_subscription_status_guard();

-- BEGIN generated: calibra_public_api_webhook_delivery_status_guard
CREATE OR REPLACE FUNCTION calibra_public_api_webhook_delivery_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('PENDING') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal webhook delivery creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A webhook delivery is created in PENDING.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('PENDING', 'SUCCESS'),
    ('PENDING', 'FAILED')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal webhook delivery transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the webhook delivery with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_public_api_webhook_delivery_status_guard

DROP TRIGGER IF EXISTS public_api_webhook_delivery_status_transition_guard ON public.public_api_webhook_delivery;
CREATE TRIGGER public_api_webhook_delivery_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.public_api_webhook_delivery
  FOR EACH ROW EXECUTE FUNCTION calibra_public_api_webhook_delivery_status_guard();

-- BEGIN generated: calibra_organization_status_guard
CREATE OR REPLACE FUNCTION calibra_organization_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('ACTIVE') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal organization creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A organization is created in ACTIVE.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('ACTIVE', 'SUSPENDED')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal organization transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the organization with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_organization_status_guard

DROP TRIGGER IF EXISTS organization_status_transition_guard ON public.organization;
CREATE TRIGGER organization_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.organization
  FOR EACH ROW EXECUTE FUNCTION calibra_organization_status_guard();

-- BEGIN generated: calibra_organization_unit_status_guard
CREATE OR REPLACE FUNCTION calibra_organization_unit_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('ACTIVE') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal organization unit creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A organization unit is created in ACTIVE.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('ACTIVE', 'ARCHIVED'),
    ('ARCHIVED', 'ACTIVE')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal organization unit transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the organization unit with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_organization_unit_status_guard

DROP TRIGGER IF EXISTS organization_unit_status_transition_guard ON public.organization_unit;
CREATE TRIGGER organization_unit_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.organization_unit
  FOR EACH ROW EXECUTE FUNCTION calibra_organization_unit_status_guard();

-- BEGIN generated: calibra_organization_email_domain_status_guard
CREATE OR REPLACE FUNCTION calibra_organization_email_domain_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('pending', 'verified', 'failed', 'not_started', 'partially_verified', 'partially_failed') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal email domain creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A email domain is created in pending, verified, failed, not_started, partially_verified, partially_failed.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('pending', 'verified'),
    ('pending', 'failed'),
    ('pending', 'not_started'),
    ('pending', 'partially_verified'),
    ('pending', 'partially_failed'),
    ('verified', 'pending'),
    ('verified', 'failed'),
    ('verified', 'not_started'),
    ('verified', 'partially_verified'),
    ('verified', 'partially_failed'),
    ('failed', 'pending'),
    ('failed', 'verified'),
    ('failed', 'not_started'),
    ('failed', 'partially_verified'),
    ('failed', 'partially_failed'),
    ('not_started', 'pending'),
    ('not_started', 'verified'),
    ('not_started', 'failed'),
    ('not_started', 'partially_verified'),
    ('not_started', 'partially_failed'),
    ('partially_verified', 'pending'),
    ('partially_verified', 'verified'),
    ('partially_verified', 'failed'),
    ('partially_verified', 'not_started'),
    ('partially_verified', 'partially_failed'),
    ('partially_failed', 'pending'),
    ('partially_failed', 'verified'),
    ('partially_failed', 'failed'),
    ('partially_failed', 'not_started'),
    ('partially_failed', 'partially_verified')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal email domain transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the email domain with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_organization_email_domain_status_guard

DROP TRIGGER IF EXISTS organization_email_domain_status_transition_guard ON public.organization_email_domain;
CREATE TRIGGER organization_email_domain_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.organization_email_domain
  FOR EACH ROW EXECUTE FUNCTION calibra_organization_email_domain_status_guard();

-- BEGIN generated: calibra_organization_email_domain_key_status_guard
CREATE OR REPLACE FUNCTION calibra_organization_email_domain_key_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.key_status IN ('ok') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal email domain key creation key_status %', NEW.key_status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'key_status',
            HINT = 'A email domain key is created in ok.';
  END IF;

  IF NEW.key_status IS NOT DISTINCT FROM OLD.key_status THEN
    RETURN NEW;
  END IF;

  IF (OLD.key_status, NEW.key_status) IN (
    ('ok', 'invalid'),
    ('ok', 'rate_limited'),
    ('rate_limited', 'invalid'),
    ('invalid', 'rate_limited'),
    ('invalid', 'ok'),
    ('rate_limited', 'ok')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal email domain key transition % -> %', OLD.key_status, NEW.key_status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'key_status',
          HINT = 'Move the email domain key with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_organization_email_domain_key_status_guard

DROP TRIGGER IF EXISTS organization_email_domain_key_status_transition_guard ON public.organization_email_domain;
CREATE TRIGGER organization_email_domain_key_status_transition_guard
  BEFORE INSERT OR UPDATE OF key_status ON public.organization_email_domain
  FOR EACH ROW EXECUTE FUNCTION calibra_organization_email_domain_key_status_guard();

-- BEGIN generated: calibra_notification_status_guard
CREATE OR REPLACE FUNCTION calibra_notification_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('UNREAD') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal notification creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A notification is created in UNREAD.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('UNREAD', 'READ'),
    ('UNREAD', 'ARCHIVED'),
    ('READ', 'ARCHIVED')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal notification transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the notification with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_notification_status_guard

DROP TRIGGER IF EXISTS notification_status_transition_guard ON public.notification;
CREATE TRIGGER notification_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.notification
  FOR EACH ROW EXECUTE FUNCTION calibra_notification_status_guard();

-- BEGIN generated: calibra_app_queue_job_status_guard
CREATE OR REPLACE FUNCTION calibra_app_queue_job_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('PENDING') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal queue job creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A queue job is created in PENDING.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('PENDING', 'PROCESSING'),
    ('PROCESSING', 'COMPLETED'),
    ('PROCESSING', 'PENDING'),
    ('PROCESSING', 'FAILED'),
    ('PENDING', 'COMPLETED')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal queue job transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the queue job with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_app_queue_job_status_guard

DROP TRIGGER IF EXISTS app_queue_job_status_transition_guard ON public.app_queue_job;
CREATE TRIGGER app_queue_job_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.app_queue_job
  FOR EACH ROW EXECUTE FUNCTION calibra_app_queue_job_status_guard();

-- BEGIN generated: calibra_queue_job_receipt_status_guard
CREATE OR REPLACE FUNCTION calibra_queue_job_receipt_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('RUNNING') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal queue job receipt creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A queue job receipt is created in RUNNING.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('RUNNING', 'COMPLETED')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal queue job receipt transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the queue job receipt with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_queue_job_receipt_status_guard

DROP TRIGGER IF EXISTS queue_job_receipt_status_transition_guard ON public.queue_job_receipt;
CREATE TRIGGER queue_job_receipt_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.queue_job_receipt
  FOR EACH ROW EXECUTE FUNCTION calibra_queue_job_receipt_status_guard();

-- BEGIN generated: calibra_portal_export_job_status_guard
CREATE OR REPLACE FUNCTION calibra_portal_export_job_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('PENDING') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal portal export job creation status %', NEW.status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'status',
            HINT = 'A portal export job is created in PENDING.';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
    ('PENDING', 'PROCESSING'),
    ('PROCESSING', 'COMPLETED'),
    ('PENDING', 'FAILED'),
    ('PROCESSING', 'FAILED')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal portal export job transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'status',
          HINT = 'Move the portal export job with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_portal_export_job_status_guard

DROP TRIGGER IF EXISTS portal_export_job_status_transition_guard ON public.portal_export_job;
CREATE TRIGGER portal_export_job_status_transition_guard
  BEFORE INSERT OR UPDATE OF status ON public.portal_export_job
  FOR EACH ROW EXECUTE FUNCTION calibra_portal_export_job_status_guard();

-- BEGIN generated: calibra_cron_run_last_status_guard
CREATE OR REPLACE FUNCTION calibra_cron_run_last_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF calibra_history_rewrite_allowed()
     OR (calibra_session_is_owner()
         AND coalesce(current_setting('calibra.allow_status_repair', true), '') = 'on') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.last_status IS NULL OR NEW.last_status IN ('ok', 'error') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'calibra: illegal cron run creation last_status %', NEW.last_status
      USING ERRCODE = 'CF001',
            TABLE = TG_TABLE_NAME,
            COLUMN = 'last_status',
            HINT = 'A cron run is created in ok, error.';
  END IF;

  IF NEW.last_status IS NOT DISTINCT FROM OLD.last_status THEN
    RETURN NEW;
  END IF;

  IF OLD.last_status IS NULL AND NEW.last_status IN ('ok', 'error') THEN
    RETURN NEW;
  END IF;

  IF (OLD.last_status, NEW.last_status) IN (
    ('ok', 'error'),
    ('error', 'ok')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'calibra: illegal cron run transition % -> %', OLD.last_status, NEW.last_status
    USING ERRCODE = 'CF001',
          TABLE = TG_TABLE_NAME,
          COLUMN = 'last_status',
          HINT = 'Move the cron run with its lifecycle commands (packages/schemas state machines); an audited repair sets calibra.allow_status_repair = on for one transaction.';
END
$$;
-- END generated: calibra_cron_run_last_status_guard

DROP TRIGGER IF EXISTS cron_run_last_status_transition_guard ON public.cron_run;
CREATE TRIGGER cron_run_last_status_transition_guard
  BEFORE INSERT OR UPDATE OF last_status ON public.cron_run
  FOR EACH ROW EXECUTE FUNCTION calibra_cron_run_last_status_guard();
