// Every status column whose lifecycle is a state machine in
// @calibra-facil/schemas, with the Postgres guard generated from it
// (status-guard-sql.ts). calibration_job.status keeps its own generator
// (job-transitions-sql.ts, migrations 0119/0139).
//
// Adding a column here, or changing a machine listed here, needs a migration
// carrying the output of `pnpm --filter @calibra-facil/db gen:status-guards-sql`
// and the same text in sql/schema-extras.sql (status-guard-sql.test.ts checks
// both).
import {
  APP_QUEUE_JOB_MACHINE,
  ASSET_MACHINE,
  ASSET_OOT_EVENT_MACHINE,
  BILLING_DOCUMENT_MACHINE,
  BILLING_EXPORT_MACHINE,
  CALIBRATION_REQUEST_MACHINE,
  CERTIFICATE_RELEASE_MACHINE,
  COMMERCIAL_AGREEMENT_MACHINE,
  EMAIL_DOMAIN_KEY_MACHINE,
  EMAIL_DOMAIN_MACHINE,
  INTEGRATION_MACHINE,
  INTEGRATION_SYNC_ITEM_MACHINE,
  INTEGRATION_SYNC_RUN_MACHINE,
  COMPETENCE_MACHINE,
  CRON_RUN_MACHINE,
  CORRECTIVE_ACTION_MACHINE,
  MASS_PROFILE_MACHINE,
  NON_CONFORMANCE_MACHINE,
  NOTIFICATION_MACHINE,
  OOT_NOTIFICATION_MACHINE,
  ORGANIZATION_MACHINE,
  ORGANIZATION_UNIT_MACHINE,
  PORTAL_EXPORT_JOB_MACHINE,
  PT_OVERALL_MACHINE,
  QUEUE_JOB_RECEIPT_MACHINE,
  RECEIVABLE_INSTALLMENT_MACHINE,
  METHOD_MACHINE,
  SERVICE_ORDER_MACHINE,
  SIGNATORY_MACHINE,
  SPC_MACHINE,
  REFERENCE_STANDARD_MACHINE,
  SERVICE_ORDER_QUOTE_MACHINE,
  STANDARD_RECALL_MACHINE,
  TRAINING_MACHINE,
  WEBHOOK_DELIVERY_MACHINE,
  WEBHOOK_SUBSCRIPTION_MACHINE,
  VISIT_MACHINE,
  VISIT_RESCHEDULE_REQUEST_MACHINE,
} from "@calibra-facil/schemas/machines";
import type { GuardedColumn } from "./status-guard-sql";

export const STATUS_GUARDED_COLUMNS: readonly GuardedColumn[] = [
  { table: "service_order", column: "status", machine: SERVICE_ORDER_MACHINE },
  {
    table: "service_order_quote",
    column: "status",
    machine: SERVICE_ORDER_QUOTE_MACHINE,
  },
  { table: "calibration_visit", column: "status", machine: VISIT_MACHINE },
  {
    table: "visit_reschedule_request",
    column: "status",
    machine: VISIT_RESCHEDULE_REQUEST_MACHINE,
  },
  {
    table: "calibration_request",
    column: "status",
    machine: CALIBRATION_REQUEST_MACHINE,
  },
  { table: "calibration_method", column: "status", machine: METHOD_MACHINE },
  { table: "asset", column: "status", machine: ASSET_MACHINE },
  {
    table: "reference_standard",
    column: "status",
    machine: REFERENCE_STANDARD_MACHINE,
  },
  {
    table: "mass_composition_profile",
    column: "status",
    machine: MASS_PROFILE_MACHINE,
  },
  {
    table: "corrective_action",
    column: "status",
    machine: CORRECTIVE_ACTION_MACHINE,
  },
  {
    table: "non_conformance",
    column: "status",
    machine: NON_CONFORMANCE_MACHINE,
  },
  {
    table: "standard_recall",
    column: "status",
    machine: STANDARD_RECALL_MACHINE,
  },
  {
    table: "oot_notification",
    column: "status",
    machine: OOT_NOTIFICATION_MACHINE,
  },
  {
    table: "asset_oot_event",
    column: "status",
    machine: ASSET_OOT_EVENT_MACHINE,
  },
  {
    table: "personnel_competence",
    column: "status",
    machine: COMPETENCE_MACHINE,
  },
  { table: "training_record", column: "status", machine: TRAINING_MACHINE },
  {
    table: "authorized_signatory",
    column: "status",
    machine: SIGNATORY_MACHINE,
  },
  {
    table: "proficiency_test",
    column: "overall_status",
    machine: PT_OVERALL_MACHINE,
  },
  { table: "control_chart", column: "status", machine: SPC_MACHINE },
  {
    table: "certificate_release",
    column: "status",
    machine: CERTIFICATE_RELEASE_MACHINE,
  },
  {
    table: "commercial_agreement",
    column: "status",
    machine: COMMERCIAL_AGREEMENT_MACHINE,
  },
  {
    table: "billing_document",
    column: "status",
    machine: BILLING_DOCUMENT_MACHINE,
  },
  {
    table: "billing_document",
    column: "export_status",
    machine: BILLING_EXPORT_MACHINE,
  },
  {
    table: "receivable_installment",
    column: "status",
    machine: RECEIVABLE_INSTALLMENT_MACHINE,
  },
  {
    table: "organization_integration",
    column: "status",
    machine: INTEGRATION_MACHINE,
  },
  {
    table: "integration_sync_run",
    column: "status",
    machine: INTEGRATION_SYNC_RUN_MACHINE,
  },
  {
    table: "integration_sync_item",
    column: "status",
    machine: INTEGRATION_SYNC_ITEM_MACHINE,
  },
  {
    table: "public_api_webhook_subscription",
    column: "status",
    machine: WEBHOOK_SUBSCRIPTION_MACHINE,
  },
  {
    table: "public_api_webhook_delivery",
    column: "status",
    machine: WEBHOOK_DELIVERY_MACHINE,
  },
  { table: "organization", column: "status", machine: ORGANIZATION_MACHINE },
  {
    table: "organization_unit",
    column: "status",
    machine: ORGANIZATION_UNIT_MACHINE,
  },
  {
    table: "organization_email_domain",
    column: "status",
    machine: EMAIL_DOMAIN_MACHINE,
  },
  {
    table: "organization_email_domain",
    column: "key_status",
    machine: EMAIL_DOMAIN_KEY_MACHINE,
  },
  { table: "notification", column: "status", machine: NOTIFICATION_MACHINE },
  { table: "app_queue_job", column: "status", machine: APP_QUEUE_JOB_MACHINE },
  {
    table: "queue_job_receipt",
    column: "status",
    machine: QUEUE_JOB_RECEIPT_MACHINE,
  },
  {
    table: "portal_export_job",
    column: "status",
    machine: PORTAL_EXPORT_JOB_MACHINE,
  },
  {
    table: "cron_run",
    column: "last_status",
    machine: CRON_RUN_MACHINE,
    nullable: true,
  },
];

// Status columns deliberately NOT guarded here:
//   calibration_job.status        its own generator (job-transitions-sql.ts)
//   invitation.status             Better-Auth writes it (INVITATION_MACHINE
//                                   documents the lifecycle)
//   billing_group.status          no writer exists (the table is unused)
//   issued_certificate_snapshot.status  append-only; the certificate's
//                                   lifecycle is its status events
//                                   (certificate-lifecycle.ts)
