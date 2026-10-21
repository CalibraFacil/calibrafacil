-- organization_id on every tenant table (decision Q15: prerequisite for row-level
-- security). docs/architecture/tenancy.md is the classification of every table.
--
-- 37 tenant tables had no organization column: the 16 *_audit_log tables
-- that point at their entity through a soft reference, the finance children
-- (installments, receipts, invoice lines, ...), the service_order_* children and
-- a few more. Each gets:
--
--   1. `organization_id text`, backfilled from its parent (set-based UPDATE ... FROM
--      parent, parents first), then NOT NULL, with a foreign key to organization
--      ON DELETE RESTRICT (evidence must not cascade, records-retention.md) and an
--      index led by organization_id.
--   2. A composite foreign key (parent_id, organization_id) -> parent
--      (id, organization_id), backed by UNIQUE (id, organization_id) on the parent
--      (the column order of the integration_* composite keys), so a child cannot
--      point at another tenant's row. It repeats the action of the single-column
--      foreign key that stays in place. Nullable ON DELETE SET NULL pointers are
--      not paired: a composite SET NULL would also null organization_id.
--
-- Safety: the whole migration is one transaction. Rows that cannot be attributed
-- (an audit-log row whose entity row is gone, an orphan child) or that already
-- point across tenants make it RAISE with the table names and counts before any
-- constraint is added; nothing is applied. The *_audit_log tables are append-only
-- (migration 0115), so the backfill lifts that guard with the documented
-- transaction-local calibra.allow_audit_rewrite and puts it back.
--
-- Idempotent, because this project applies migration DDL by hand and the drizzle
-- bookkeeping table lags behind it: ADD COLUMN IF NOT EXISTS, the backfill only
-- touches NULL, constraints and indexes are looked up by name first. Constraint
-- names follow drizzle's (Postgres truncates them at 63 characters).
DO $$
DECLARE
  child record;
  edge record;
  missing bigint;
  report text := '';
BEGIN
  PERFORM set_config('calibra.allow_audit_rewrite', 'on', true);

  -- 1. Columns and backfill, parents before children.
  FOR child IN
    SELECT * FROM (VALUES
        (1, 'receivable_installment', 'document_id', 'billing_document', 'organization_id'),
        (2, 'payment_receipt', 'installment_id', 'receivable_installment', 'organization_id'),
        (3, 'billing_document_item', 'document_id', 'billing_document', 'organization_id'),
        (4, 'billing_group_service_order', 'group_id', 'billing_group', 'organization_id'),
        (5, 'commercial_agreement_service_term', 'agreement_id', 'commercial_agreement', 'organization_id'),
        (6, 'commercial_agreement_unit_scope', 'agreement_id', 'commercial_agreement', 'organization_id'),
        (7, 'job_standard', 'job_id', 'calibration_job', 'organization_id'),
        (8, 'asset_oot_impact_assessment', 'event_id', 'asset_oot_event', 'lab_organization_id'),
        (9, 'calibration_request_item', 'request_id', 'calibration_request', 'organization_id'),
        (10, 'service_order_asset_snapshot', 'service_order_id', 'service_order', 'organization_id'),
        (11, 'service_order_attachment', 'service_order_id', 'service_order', 'organization_id'),
        (12, 'service_order_certificate_link', 'service_order_id', 'service_order', 'organization_id'),
        (13, 'service_order_delivery_document', 'service_order_id', 'service_order', 'organization_id'),
        (14, 'service_order_email_log', 'service_order_id', 'service_order', 'organization_id'),
        (15, 'service_order_evaluation', 'service_order_id', 'service_order', 'organization_id'),
        (16, 'service_order_execution', 'service_order_id', 'service_order', 'organization_id'),
        (17, 'service_order_execution_item', 'execution_id', 'service_order_execution', 'organization_id'),
        (18, 'service_order_intake_document', 'service_order_id', 'service_order', 'organization_id'),
        (19, 'service_order_quote', 'service_order_id', 'service_order', 'organization_id'),
        (20, 'service_order_quote_item', 'quote_id', 'service_order_quote', 'organization_id'),
        (21, 'service_order_tag', 'service_order_id', 'service_order', 'organization_id'),
        (22, 'asset_audit_log', 'asset_id', 'asset', 'lab_organization_id'),
        (23, 'asset_oot_audit_log', 'event_id', 'asset_oot_event', 'lab_organization_id'),
        (24, 'authorized_signatory_audit_log', 'signatory_id', 'authorized_signatory', 'organization_id'),
        (25, 'calibration_request_audit_log', 'request_id', 'calibration_request', 'organization_id'),
        (26, 'control_chart_audit_log', 'control_chart_id', 'control_chart', 'organization_id'),
        (27, 'corrective_action_audit_log', 'capa_id', 'corrective_action', 'organization_id'),
        (28, 'customer_audit_log', 'customer_id', 'customer', 'lab_organization_id'),
        (29, 'job_audit_log', 'job_id', 'calibration_job', 'organization_id'),
        (30, 'method_audit_log', 'method_id', 'calibration_method', 'organization_id'),
        (31, 'non_conformance_audit_log', 'nc_id', 'non_conformance', 'organization_id'),
        (32, 'personnel_competence_audit_log', 'competence_id', 'personnel_competence', 'organization_id'),
        (33, 'proficiency_test_audit_log', 'proficiency_test_id', 'proficiency_test', 'organization_id'),
        (34, 'reference_standard_audit_log', 'standard_id', 'reference_standard', 'organization_id'),
        (35, 'service_audit_log', 'service_id', 'service', 'organization_id'),
        (36, 'training_record_audit_log', 'training_record_id', 'training_record', 'organization_id'),
        (37, 'visit_audit_log', 'visit_id', 'calibration_visit', 'organization_id')
    ) AS v(ord, child_table, fk_column, parent_table, parent_org_column)
    ORDER BY ord
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS organization_id text', child.child_table);
    EXECUTE format(
      'UPDATE public.%I c SET organization_id = p.%I FROM public.%I p WHERE p.id = c.%I AND c.organization_id IS NULL',
      child.child_table, child.parent_org_column, child.parent_table, child.fk_column);
  END LOOP;
  PERFORM set_config('calibra.allow_audit_rewrite', '', true);

  -- 2. Pre-check: every row has an organization.
  FOR child IN
    SELECT * FROM (VALUES
        ('receivable_installment', 'document_id', 'billing_document'),
        ('payment_receipt', 'installment_id', 'receivable_installment'),
        ('billing_document_item', 'document_id', 'billing_document'),
        ('billing_group_service_order', 'group_id', 'billing_group'),
        ('commercial_agreement_service_term', 'agreement_id', 'commercial_agreement'),
        ('commercial_agreement_unit_scope', 'agreement_id', 'commercial_agreement'),
        ('job_standard', 'job_id', 'calibration_job'),
        ('asset_oot_impact_assessment', 'event_id', 'asset_oot_event'),
        ('calibration_request_item', 'request_id', 'calibration_request'),
        ('service_order_asset_snapshot', 'service_order_id', 'service_order'),
        ('service_order_attachment', 'service_order_id', 'service_order'),
        ('service_order_certificate_link', 'service_order_id', 'service_order'),
        ('service_order_delivery_document', 'service_order_id', 'service_order'),
        ('service_order_email_log', 'service_order_id', 'service_order'),
        ('service_order_evaluation', 'service_order_id', 'service_order'),
        ('service_order_execution', 'service_order_id', 'service_order'),
        ('service_order_execution_item', 'execution_id', 'service_order_execution'),
        ('service_order_intake_document', 'service_order_id', 'service_order'),
        ('service_order_quote', 'service_order_id', 'service_order'),
        ('service_order_quote_item', 'quote_id', 'service_order_quote'),
        ('service_order_tag', 'service_order_id', 'service_order'),
        ('asset_audit_log', 'asset_id', 'asset'),
        ('asset_oot_audit_log', 'event_id', 'asset_oot_event'),
        ('authorized_signatory_audit_log', 'signatory_id', 'authorized_signatory'),
        ('calibration_request_audit_log', 'request_id', 'calibration_request'),
        ('control_chart_audit_log', 'control_chart_id', 'control_chart'),
        ('corrective_action_audit_log', 'capa_id', 'corrective_action'),
        ('customer_audit_log', 'customer_id', 'customer'),
        ('job_audit_log', 'job_id', 'calibration_job'),
        ('method_audit_log', 'method_id', 'calibration_method'),
        ('non_conformance_audit_log', 'nc_id', 'non_conformance'),
        ('personnel_competence_audit_log', 'competence_id', 'personnel_competence'),
        ('proficiency_test_audit_log', 'proficiency_test_id', 'proficiency_test'),
        ('reference_standard_audit_log', 'standard_id', 'reference_standard'),
        ('service_audit_log', 'service_id', 'service'),
        ('training_record_audit_log', 'training_record_id', 'training_record'),
        ('visit_audit_log', 'visit_id', 'calibration_visit')
    ) AS v(child_table, fk_column, parent_table)
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE organization_id IS NULL', child.child_table) INTO missing;
    IF missing > 0 THEN
      report := report || format(E'\n  %s: %s row(s) whose %s matches no %s row', child.child_table, missing, child.fk_column, child.parent_table);
    END IF;
  END LOOP;
  IF report <> '' THEN
    RAISE EXCEPTION 'migration 0118 cannot attribute rows to an organization:%', report
      USING HINT = 'Each row above has no parent to take its organization from (an audit-log row of a hard-deleted entity, or an orphan). Attribute it to its laboratory with an UPDATE (under SET LOCAL calibra.allow_audit_rewrite = ''on'' for the append-only audit logs) or remove it, then re-run.';
  END IF;

  -- 3. Pre-check: no composite foreign key would be violated by existing rows.
  FOR edge IN
    SELECT * FROM (VALUES
        ('receivable_installment', 'document_id', 'billing_document', 'organization_id', 'CASCADE', 'receivable_installment_document_id_tenant_fk'),
        ('payment_receipt', 'installment_id', 'receivable_installment', 'organization_id', 'CASCADE', 'payment_receipt_installment_id_tenant_fk'),
        ('billing_document_item', 'document_id', 'billing_document', 'organization_id', 'CASCADE', 'billing_document_item_document_id_tenant_fk'),
        ('billing_group_service_order', 'group_id', 'billing_group', 'organization_id', 'CASCADE', 'billing_group_service_order_group_id_tenant_fk'),
        ('billing_group_service_order', 'service_order_id', 'service_order', 'organization_id', 'RESTRICT', 'billing_group_service_order_service_order_id_tenant_fk'),
        ('commercial_agreement_service_term', 'agreement_id', 'commercial_agreement', 'organization_id', 'CASCADE', 'commercial_agreement_service_term_agreement_id_tenant_fk'),
        ('commercial_agreement_service_term', 'service_id', 'service', 'organization_id', 'CASCADE', 'commercial_agreement_service_term_service_id_tenant_fk'),
        ('commercial_agreement_service_term', 'unit_id', 'organization_unit', 'organization_id', 'CASCADE', 'commercial_agreement_service_term_unit_id_tenant_fk'),
        ('commercial_agreement_unit_scope', 'agreement_id', 'commercial_agreement', 'organization_id', 'CASCADE', 'commercial_agreement_unit_scope_agreement_id_tenant_fk'),
        ('commercial_agreement_unit_scope', 'unit_id', 'organization_unit', 'organization_id', 'CASCADE', 'commercial_agreement_unit_scope_unit_id_tenant_fk'),
        ('job_standard', 'job_id', 'calibration_job', 'organization_id', 'CASCADE', 'job_standard_job_id_tenant_fk'),
        ('job_standard', 'standard_id', 'reference_standard', 'organization_id', 'RESTRICT', 'job_standard_standard_id_tenant_fk'),
        ('asset_oot_impact_assessment', 'event_id', 'asset_oot_event', 'lab_organization_id', 'CASCADE', 'asset_oot_impact_assessment_event_id_tenant_fk'),
        ('calibration_request_item', 'request_id', 'calibration_request', 'organization_id', 'CASCADE', 'calibration_request_item_request_id_tenant_fk'),
        ('calibration_request_item', 'asset_id', 'asset', 'lab_organization_id', 'RESTRICT', 'calibration_request_item_asset_id_tenant_fk'),
        ('service_order_asset_snapshot', 'service_order_id', 'service_order', 'organization_id', 'CASCADE', 'service_order_asset_snapshot_service_order_id_tenant_fk'),
        ('service_order_asset_snapshot', 'asset_id', 'asset', 'lab_organization_id', 'RESTRICT', 'service_order_asset_snapshot_asset_id_tenant_fk'),
        ('service_order_attachment', 'service_order_id', 'service_order', 'organization_id', 'CASCADE', 'service_order_attachment_service_order_id_tenant_fk'),
        ('service_order_certificate_link', 'service_order_id', 'service_order', 'organization_id', 'CASCADE', 'service_order_certificate_link_service_order_id_tenant_fk'),
        ('service_order_certificate_link', 'certificate_job_id', 'calibration_job', 'organization_id', 'RESTRICT', 'service_order_certificate_link_certificate_job_id_tenant_fk'),
        ('service_order_delivery_document', 'service_order_id', 'service_order', 'organization_id', 'CASCADE', 'service_order_delivery_document_service_order_id_tenant_fk'),
        ('service_order_email_log', 'service_order_id', 'service_order', 'organization_id', 'CASCADE', 'service_order_email_log_service_order_id_tenant_fk'),
        ('service_order_evaluation', 'service_order_id', 'service_order', 'organization_id', 'CASCADE', 'service_order_evaluation_service_order_id_tenant_fk'),
        ('service_order_execution', 'service_order_id', 'service_order', 'organization_id', 'CASCADE', 'service_order_execution_service_order_id_tenant_fk'),
        ('service_order_execution_item', 'execution_id', 'service_order_execution', 'organization_id', 'CASCADE', 'service_order_execution_item_execution_id_tenant_fk'),
        ('service_order_intake_document', 'service_order_id', 'service_order', 'organization_id', 'CASCADE', 'service_order_intake_document_service_order_id_tenant_fk'),
        ('service_order_quote', 'service_order_id', 'service_order', 'organization_id', 'CASCADE', 'service_order_quote_service_order_id_tenant_fk'),
        ('service_order_quote_item', 'quote_id', 'service_order_quote', 'organization_id', 'CASCADE', 'service_order_quote_item_quote_id_tenant_fk'),
        ('service_order_tag', 'service_order_id', 'service_order', 'organization_id', 'CASCADE', 'service_order_tag_service_order_id_tenant_fk')
    ) AS v(child_table, fk_column, parent_table, parent_org_column, on_delete, constraint_name)
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I c WHERE c.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.%I p WHERE p.id = c.%I AND p.%I = c.organization_id)',
      edge.child_table, edge.fk_column, edge.parent_table, edge.fk_column, edge.parent_org_column) INTO missing;
    IF missing > 0 THEN
      report := report || format(E'\n  %s: %s row(s) whose %s belongs to another organization than the row', edge.child_table, missing, edge.fk_column);
    END IF;
  END LOOP;
  IF report <> '' THEN
    RAISE EXCEPTION 'migration 0118 found rows that point at another tenant''s row:%', report
      USING HINT = 'Fix the rows above (they cross tenants), then re-run.';
  END IF;

  -- 4. NOT NULL, foreign key to organization (RESTRICT), index.
  FOR child IN
    SELECT * FROM (VALUES
        ('receivable_installment', 'organization_id', 'receivable_installment_org_idx'),
        ('payment_receipt', 'organization_id', 'payment_receipt_org_idx'),
        ('billing_document_item', 'organization_id', 'billing_document_item_org_idx'),
        ('billing_group_service_order', 'organization_id', 'billing_group_service_order_org_idx'),
        ('commercial_agreement_service_term', 'organization_id', 'commercial_agreement_service_term_org_idx'),
        ('commercial_agreement_unit_scope', 'organization_id', 'commercial_agreement_unit_scope_org_idx'),
        ('job_standard', 'organization_id', 'job_standard_org_idx'),
        ('asset_oot_impact_assessment', 'organization_id', 'asset_oot_impact_assessment_org_idx'),
        ('calibration_request_item', 'organization_id', 'calibration_request_item_org_idx'),
        ('service_order_asset_snapshot', 'organization_id', 'service_order_asset_snapshot_org_idx'),
        ('service_order_attachment', 'organization_id', 'service_order_attachment_org_idx'),
        ('service_order_certificate_link', 'organization_id', 'service_order_certificate_link_org_idx'),
        ('service_order_delivery_document', 'organization_id', 'service_order_delivery_document_org_idx'),
        ('service_order_email_log', 'organization_id', 'service_order_email_log_org_idx'),
        ('service_order_evaluation', 'organization_id', 'service_order_evaluation_org_idx'),
        ('service_order_execution', 'organization_id', 'service_order_execution_org_idx'),
        ('service_order_execution_item', 'organization_id', 'service_order_execution_item_org_idx'),
        ('service_order_intake_document', 'organization_id', 'service_order_intake_document_org_idx'),
        ('service_order_quote', 'organization_id', 'service_order_quote_org_idx'),
        ('service_order_quote_item', 'organization_id', 'service_order_quote_item_org_idx'),
        ('service_order_tag', 'organization_id', 'service_order_tag_org_idx'),
        ('asset_audit_log', 'organization_id, performed_at', 'asset_audit_log_org_performed_at_idx'),
        ('asset_oot_audit_log', 'organization_id, performed_at', 'asset_oot_audit_log_org_performed_at_idx'),
        ('authorized_signatory_audit_log', 'organization_id, performed_at', 'authorized_signatory_audit_log_org_performed_at_idx'),
        ('calibration_request_audit_log', 'organization_id, performed_at', 'calibration_request_audit_log_org_performed_at_idx'),
        ('control_chart_audit_log', 'organization_id, performed_at', 'control_chart_audit_log_org_performed_at_idx'),
        ('corrective_action_audit_log', 'organization_id, performed_at', 'corrective_action_audit_log_org_performed_at_idx'),
        ('customer_audit_log', 'organization_id, performed_at', 'customer_audit_log_org_performed_at_idx'),
        ('job_audit_log', 'organization_id, performed_at', 'job_audit_log_org_performed_at_idx'),
        ('method_audit_log', 'organization_id, performed_at', 'method_audit_log_org_performed_at_idx'),
        ('non_conformance_audit_log', 'organization_id, performed_at', 'non_conformance_audit_log_org_performed_at_idx'),
        ('personnel_competence_audit_log', 'organization_id, performed_at', 'personnel_competence_audit_log_org_performed_at_idx'),
        ('proficiency_test_audit_log', 'organization_id, performed_at', 'proficiency_test_audit_log_org_performed_at_idx'),
        ('reference_standard_audit_log', 'organization_id, performed_at', 'reference_standard_audit_log_org_performed_at_idx'),
        ('service_audit_log', 'organization_id, performed_at', 'service_audit_log_org_performed_at_idx'),
        ('training_record_audit_log', 'organization_id, performed_at', 'training_record_audit_log_org_performed_at_idx'),
        ('visit_audit_log', 'organization_id, performed_at', 'visit_audit_log_org_performed_at_idx')
    ) AS v(child_table, index_columns, index_name)
  LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organization_id SET NOT NULL', child.child_table);
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = to_regclass(format('public.%I', child.child_table))
         AND conname = left(child.child_table || '_organization_id_organization_id_fk', 63)
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE RESTRICT ON UPDATE NO ACTION',
        child.child_table, left(child.child_table || '_organization_id_organization_id_fk', 63));
    END IF;
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (%s)', child.index_name, child.child_table, child.index_columns);
  END LOOP;

  -- 5. UNIQUE (organization, id) on every parent: the target of the composite keys.
  FOR edge IN
    SELECT * FROM (VALUES
        ('billing_document', 'organization_id', 'billing_document_id_org_uidx'),
        ('receivable_installment', 'organization_id', 'receivable_installment_id_org_uidx'),
        ('billing_group', 'organization_id', 'billing_group_id_org_uidx'),
        ('service_order', 'organization_id', 'service_order_id_org_uidx'),
        ('commercial_agreement', 'organization_id', 'commercial_agreement_id_org_uidx'),
        ('service', 'organization_id', 'service_id_org_uidx'),
        ('organization_unit', 'organization_id', 'organization_unit_id_org_uidx'),
        ('calibration_job', 'organization_id', 'calibration_job_id_org_uidx'),
        ('reference_standard', 'organization_id', 'reference_standard_id_org_uidx'),
        ('asset_oot_event', 'lab_organization_id', 'asset_oot_event_id_org_uidx'),
        ('calibration_request', 'organization_id', 'calibration_request_id_org_uidx'),
        ('asset', 'lab_organization_id', 'asset_id_org_uidx'),
        ('service_order_execution', 'organization_id', 'service_order_execution_id_org_uidx'),
        ('service_order_quote', 'organization_id', 'service_order_quote_id_org_uidx')
    ) AS v(parent_table, org_column, constraint_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = to_regclass(format('public.%I', edge.parent_table))
         AND conname = edge.constraint_name
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (id, %I)', edge.parent_table, edge.constraint_name, edge.org_column);
    END IF;
  END LOOP;

  -- 6. Composite (organization_id, parent_id) foreign keys.
  FOR edge IN
    SELECT * FROM (VALUES
        ('receivable_installment', 'document_id', 'billing_document', 'organization_id', 'CASCADE', 'receivable_installment_document_id_tenant_fk'),
        ('payment_receipt', 'installment_id', 'receivable_installment', 'organization_id', 'CASCADE', 'payment_receipt_installment_id_tenant_fk'),
        ('billing_document_item', 'document_id', 'billing_document', 'organization_id', 'CASCADE', 'billing_document_item_document_id_tenant_fk'),
        ('billing_group_service_order', 'group_id', 'billing_group', 'organization_id', 'CASCADE', 'billing_group_service_order_group_id_tenant_fk'),
        ('billing_group_service_order', 'service_order_id', 'service_order', 'organization_id', 'RESTRICT', 'billing_group_service_order_service_order_id_tenant_fk'),
        ('commercial_agreement_service_term', 'agreement_id', 'commercial_agreement', 'organization_id', 'CASCADE', 'commercial_agreement_service_term_agreement_id_tenant_fk'),
        ('commercial_agreement_service_term', 'service_id', 'service', 'organization_id', 'CASCADE', 'commercial_agreement_service_term_service_id_tenant_fk'),
        ('commercial_agreement_service_term', 'unit_id', 'organization_unit', 'organization_id', 'CASCADE', 'commercial_agreement_service_term_unit_id_tenant_fk'),
        ('commercial_agreement_unit_scope', 'agreement_id', 'commercial_agreement', 'organization_id', 'CASCADE', 'commercial_agreement_unit_scope_agreement_id_tenant_fk'),
        ('commercial_agreement_unit_scope', 'unit_id', 'organization_unit', 'organization_id', 'CASCADE', 'commercial_agreement_unit_scope_unit_id_tenant_fk'),
        ('job_standard', 'job_id', 'calibration_job', 'organization_id', 'CASCADE', 'job_standard_job_id_tenant_fk'),
        ('job_standard', 'standard_id', 'reference_standard', 'organization_id', 'RESTRICT', 'job_standard_standard_id_tenant_fk'),
        ('asset_oot_impact_assessment', 'event_id', 'asset_oot_event', 'lab_organization_id', 'CASCADE', 'asset_oot_impact_assessment_event_id_tenant_fk'),
        ('calibration_request_item', 'request_id', 'calibration_request', 'organization_id', 'CASCADE', 'calibration_request_item_request_id_tenant_fk'),
        ('calibration_request_item', 'asset_id', 'asset', 'lab_organization_id', 'RESTRICT', 'calibration_request_item_asset_id_tenant_fk'),
        ('service_order_asset_snapshot', 'service_order_id', 'service_order', 'organization_id', 'CASCADE', 'service_order_asset_snapshot_service_order_id_tenant_fk'),
        ('service_order_asset_snapshot', 'asset_id', 'asset', 'lab_organization_id', 'RESTRICT', 'service_order_asset_snapshot_asset_id_tenant_fk'),
        ('service_order_attachment', 'service_order_id', 'service_order', 'organization_id', 'CASCADE', 'service_order_attachment_service_order_id_tenant_fk'),
        ('service_order_certificate_link', 'service_order_id', 'service_order', 'organization_id', 'CASCADE', 'service_order_certificate_link_service_order_id_tenant_fk'),
        ('service_order_certificate_link', 'certificate_job_id', 'calibration_job', 'organization_id', 'RESTRICT', 'service_order_certificate_link_certificate_job_id_tenant_fk'),
        ('service_order_delivery_document', 'service_order_id', 'service_order', 'organization_id', 'CASCADE', 'service_order_delivery_document_service_order_id_tenant_fk'),
        ('service_order_email_log', 'service_order_id', 'service_order', 'organization_id', 'CASCADE', 'service_order_email_log_service_order_id_tenant_fk'),
        ('service_order_evaluation', 'service_order_id', 'service_order', 'organization_id', 'CASCADE', 'service_order_evaluation_service_order_id_tenant_fk'),
        ('service_order_execution', 'service_order_id', 'service_order', 'organization_id', 'CASCADE', 'service_order_execution_service_order_id_tenant_fk'),
        ('service_order_execution_item', 'execution_id', 'service_order_execution', 'organization_id', 'CASCADE', 'service_order_execution_item_execution_id_tenant_fk'),
        ('service_order_intake_document', 'service_order_id', 'service_order', 'organization_id', 'CASCADE', 'service_order_intake_document_service_order_id_tenant_fk'),
        ('service_order_quote', 'service_order_id', 'service_order', 'organization_id', 'CASCADE', 'service_order_quote_service_order_id_tenant_fk'),
        ('service_order_quote_item', 'quote_id', 'service_order_quote', 'organization_id', 'CASCADE', 'service_order_quote_item_quote_id_tenant_fk'),
        ('service_order_tag', 'service_order_id', 'service_order', 'organization_id', 'CASCADE', 'service_order_tag_service_order_id_tenant_fk')
    ) AS v(child_table, fk_column, parent_table, parent_org_column, on_delete, constraint_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = to_regclass(format('public.%I', edge.child_table))
         AND conname = edge.constraint_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I, organization_id) REFERENCES public.%I (id, %I) ON DELETE %s ON UPDATE NO ACTION',
        edge.child_table, edge.constraint_name, edge.fk_column, edge.parent_table, edge.parent_org_column, edge.on_delete);
    END IF;
  END LOOP;
END
$$;
