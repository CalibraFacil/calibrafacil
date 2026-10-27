// The evidence tables of the database (ISO/IEC 17025 7.5.2, 8.4, 7.11.3): the
// records whose history must not be rewritten by the application.
//
// Two layers protect them, and this file is the one place that says which table is
// protected by which:
//
//   1. PRIVILEGES. `calibra_app`, the role the API, the worker and the CLI connect
//      as, is not granted UPDATE, DELETE or TRUNCATE on an append-only table: a
//      statement the application should never issue fails with "permission denied"
//      before any trigger runs (the generated block of `evidenceGrantsBlock()` in
//      rls-sql.ts). The application cannot lift it: only the table
//      owner can GRANT.
//   2. TRIGGERS (migrations 0115, 0119, 0120): the append-only guard, the frozen
//      calibration_job / certificate_input guards and the status machine. They
//      answer for the tables whose application path legitimately UPDATEs or DELETEs
//      some rows, and for the owner path, whose escape hatch is a GUC that works
//      only for a session of the table owner (`calibra_session_is_owner()`).
//
// A drift test (evidence-tables.test.ts) checks this classification against the
// triggers in sql/schema-extras.sql and against the schema, so a new audit or event
// log cannot ship without being listed here.

/**
 * Append-only evidence: INSERT and SELECT only for `calibra_app`. Their
 * `calibra_append_only` trigger (migration 0115) stays as the second layer: it
 * guards the owner path and the one documented exception, the ON DELETE SET NULL
 * action of a foreign key (executed as the table owner by Postgres, so it needs no
 * privilege of the application role).
 */
export const APPEND_ONLY_EVIDENCE_TABLES: readonly string[] = [
  "accredited_scope_line_audit_log",
  "asset_audit_log",
  "asset_oot_audit_log",
  "authorized_signatory_audit_log",
  "automatic_send_audit_log",
  "calibration_request_audit_log",
  "certificate_numbering_audit_log",
  "certificate_release_audit_log",
  "control_chart_audit_log",
  "corrective_action_audit_log",
  "customer_audit_log",
  "financial_audit_log",
  "integration_event_log",
  "issued_certificate_snapshot",
  "issued_certificate_status_event",
  "job_audit_log",
  "method_audit_log",
  "non_conformance_audit_log",
  "organization_api_key_audit_log",
  "organization_compliance_audit_log",
  "organization_event_log",
  "personnel_competence_audit_log",
  "proficiency_test_audit_log",
  "reference_standard_audit_log",
  "service_audit_log",
  "service_order_event_log",
  "training_record_audit_log",
  "visit_audit_log",
];

/**
 * Evidence that is never UPDATEd but may be DELETEd in one documented case:
 * `certificate_input`, the frozen input of a certificate, is deleted while its job
 * is back in REVIEW (an approval whose dispatch failed is reverted; migration 0120).
 * UPDATE and TRUNCATE are revoked; DELETE stays granted and the trigger decides.
 */
export const NO_UPDATE_EVIDENCE_TABLES: readonly string[] = [
  "certificate_input",
];

/**
 * Tables with an immutability trigger that the privileges deliberately do NOT
 * narrow, with the reason. A drift test requires every audit/event log to be in one
 * of the lists.
 */
export const TRIGGER_ONLY_EVIDENCE_TABLES: Readonly<Record<string, string>> = {
  calibration_job:
    "the application UPDATEs a job all through its life (draft, execution, review, approval); only an APPROVED or SUPERSEDED job is frozen, and that is the trigger's decision (calibra_calibration_job_guard)",
  platform_event_log:
    "the public-signup reservation row (action public.signup.provisioned, status RESERVED) is updated when the signup completes and deleted when it fails; every other row is append-only by trigger",
  organization:
    "a LAB organization cannot be hard-deleted (calibra_organization_delete_guard) except by the owner path; the application still UPDATEs organizations and deletes CLIENT organizations",
};
