/**
 * Registry of the stable error codes the API puts in `{ error, code }` bodies.
 *
 * This is the ONE place a code is declared. The server (`apps/api`) builds
 * `DomainError`s from it, `packages/client-runtime` surfaces it on
 * `CalibraApiError.code`, and the frontends branch on it instead of parsing
 * the pt-BR `error` text. To add a code: append it here, throw it from the
 * route, done — a typo anywhere else is a compile error.
 *
 * Codes are snake_case and never reused for a different meaning. Removing or
 * renaming one is a breaking API change.
 */
export const API_ERROR_CODES = [
  // Generic fall-backs for failures that have no dedicated code yet.
  "invalid_request",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "unprocessable",

  // Cross-cutting.
  "record_immutable",
  "concurrent_update",
  "idempotency_conflict",
  "idempotency_in_progress",
  "missing_idempotency_key",
  // Lifecycle state machines (packages/schemas machines): the record left the
  // state the command was checked from (a lost compare-and-set), or the database
  // guard refused a move its machine does not list.
  "status_transition_conflict",

  // Job status machine.
  "job_status_conflict",
  "job_not_found",
  "job_not_cancelable",
  "job_not_submittable",
  "job_not_rejectable",
  "job_render_not_retryable",
  "job_not_executable",
  "job_not_editable",
  "job_not_assignable",
  "job_not_amendable",
  "job_already_amended",
  "job_amendment_in_progress",
  "job_certificate_withdrawn",
  "certificate_not_issued",
  "certificate_already_withdrawn",
  "job_not_approvable",
  "job_status_payload_mismatch",
  "job_create_failed",
  "approval_conflict",
  "approval_dispatch_failed",
  "approval_requires_signatory",
  "self_approval_blocked",
  "environmental_justification_required",
  "scope_violation",
  "standard_expired",
  "standard_not_found",
  "standard_deleted",
  "standard_inactive",
  "standard_backdate_reason_required",
  "standard_not_out_of_tolerance",
  "jobs_not_linked_to_standard",
  "performed_at_invalid",
  "performed_at_future",
  "backdate_reason_required",
  "asset_specification_missing",
  "calibration_record_incomplete",
  "official_execution_failed",
  "technician_competence_missing",
  "training_record_mismatch",
  "certificate_not_found",
  "certificate_not_ready",

  // Customers, assets, units, services.
  "customer_not_found",
  "customer_create_failed",
  "customer_group_not_found",
  "customer_group_create_failed",
  "customer_not_in_group",
  "cnpj_invalid",
  "cnpj_not_found",
  "portal_invitation_failed",
  "portal_invitation_not_found",
  "portal_invitation_not_pending",
  "portal_member_not_found",
  "portal_member_not_removable",
  "asset_not_found",
  "asset_type_not_found",
  "asset_tag_conflict",
  "asset_create_failed",
  "asset_base_measurement_unit_required",
  "invalid_assets",
  "unit_not_found",
  "unit_asset_mismatch",
  "service_not_found",
  "technician_not_found",

  // Quality records (SPC, proficiency testing) and the laboratory's setup.
  "control_chart_not_found",
  "control_chart_exists",
  "control_chart_already_escalated",
  "control_chart_in_control",
  "check_standard_reading_not_found",
  "proficiency_test_not_found",
  "pt_plan_item_not_found",
  "scope_line_not_found",
  "scope_line_unit_mismatch",
  "environmental_limits_not_found",
  "material_not_found",
  "material_sku_conflict",
  "member_not_found",
  "unit_default_not_archivable",
  "unit_active_required",
  // Methods (the lifecycle machine, the dimensional gate, the template catalog)
  // and the commercial services built on them.
  "method_not_found",
  "method_name_taken",
  "method_not_editable",
  "method_not_submittable",
  "method_has_no_inputs",
  "method_not_reviewable",
  "method_not_publishable",
  "method_review_required",
  "method_not_returnable",
  "method_not_archivable",
  "method_not_versionable",
  "method_draft_exists",
  "method_not_deletable",
  "method_compile_failed",
  "method_asset_type_mismatch",
  "template_not_found",
  "template_acknowledgements_missing",
  // Quality records (non-conformances, CAPA).
  "non_conformance_not_found",
  "capa_not_found",

  // Service requests.
  "request_not_found",
  "request_not_editable",
  "request_not_cancelable",
  "multi_unit_request_not_allowed",
  "request_status_invalid",
  "request_already_active",

  // On-site visits.
  "visit_not_found",
  "visit_closed",
  "visit_not_proposed",
  "visit_not_scheduled",
  "visit_reschedule_pending",
  "visit_reschedule_request_not_found",

  // Service orders (OS), their quotes and the public approval links.
  "service_order_not_found",
  "service_order_invalid_asset",
  "service_order_source_not_found",
  "service_order_invalid_transition",
  "service_order_certificate_not_found",
  "service_order_certificate_incompatible",
  "service_order_evaluation_not_found",
  "service_order_evaluation_exists",
  "service_order_evaluation_reason_required",
  "service_order_execution_not_started",
  "service_order_pdf_unavailable",
  "service_order_quote_not_found",
  "service_order_quote_not_sendable",
  "service_order_quote_not_decidable",
  "public_link_invalid",
  "public_link_answered",
  "public_code_invalid",
  "public_code_throttled",

  // Records retention: organization lifecycle and the
  // customers / API keys that depend on it.
  "organization_confirmation_mismatch",
  "organization_already_deleted",
  "organization_suspended",
  "organization_deleted",
  "customer_has_retained_records",

  // Offline attachment upload leg (the desktop upload endpoints; the same
  // refusals reach a pushed event as the upper-case codes of outbox-rejections.ts).
  "sync_attachment_type_not_allowed",
  "sync_attachment_too_large",
  "sync_attachment_not_uploaded",
  "sync_attachment_integrity_failed",

  // Finance: billing documents, installments, agreements, certificate release,
  // automatic send rules and the ERP export.
  "billing_document_not_found",
  "billing_document_not_draft",
  "billing_document_already_void",
  "billing_document_edit_reason_required",
  "billing_document_outside_unit_scope",
  "billing_jobs_not_found",
  "billing_jobs_not_billable",
  "billing_jobs_already_documented",
  "billing_jobs_not_consolidatable",
  "billing_single_job_mode_violation",
  "installment_not_found",
  "installment_not_receivable",
  "installment_document_void",
  "installment_partial_receipt_unsupported",
  "agreement_not_found",
  "agreement_terms_required",
  "agreement_reference_invalid",
  "invalid_limit",
  "release_not_calculated",
  "release_reason_required",
  "release_certificate_not_approved",
  "release_unavailable",
  "release_policy_not_found",
  "release_policy_default_exists",
  "release_policy_default_not_archivable",
  "automatic_send_rule_not_found",
  "automatic_send_default_exists",
  "automatic_send_default_not_archivable",
  "rule_customer_invalid",
  "rule_agreement_invalid",

  // Integrations (ERP connections, Conta Azul, sync runs, drift).
  "integration_not_found",
  "integration_provider_mismatch",
  "integration_mappings_invalid",
  "integration_inactive",
  "integration_action_required",
  "integration_request_failed",
  "integration_sync_blocked",
  "integration_sync_in_progress",
  "integration_sync_dispatch_failed",
  "integration_run_not_found",
  "integration_run_in_progress",
  "integration_catalog_invalid",
  "integration_reason_required",
  "conta_azul_app_missing",
  "conta_azul_app_rejected",
  "conta_azul_oauth_unavailable",

  // Webhooks.
  "webhook_not_found",
  "webhook_delivery_not_found",
  "payload_too_large",

  // Laboratory settings and access: API keys, e-mail sending domains, SSO,
  // sessions, notifications, invitations, the account-setup link, self-serve
  // sign-up and the signing credential's server configuration.
  "api_key_not_found",
  "email_domain_not_found",
  "email_domain_not_verified",
  "email_domain_provider_failed",
  "email_domain_server_config",
  "sso_provider_not_found",
  "sso_provider_reload_failed",
  "sso_domain_not_verified",
  "session_not_found",
  "notification_not_found",
  "invitation_not_found",
  "lab_setup_token_invalid",
  "lab_setup_delivery_failed",
  "signup_domain_cap_reached",
  "signup_unavailable",
  "signing_not_configured",

  // Client portal and public verification: audit packs, out-of-tolerance
  // notices and events, the portal's own host and domain.
  "portal_customer_not_linked",
  "certificate_payment_pending",
  "standard_certificate_not_available",
  "audit_pack_not_found",
  "audit_pack_not_ready",
  "audit_pack_expired",
  "audit_pack_too_large",
  "audit_pack_empty",
  "oot_notification_not_found",
  "oot_event_not_found",
  "oot_assessment_exists",
  "portal_domain_not_configured",
  "portal_domain_not_verified",
  "portal_domain_txt_not_found",
  "portal_domain_in_use",
  "invalid_verification_token",
  "certificate_integrity_record_missing",

  // LEGACY (upper-case): shipped before this registry existed. Kept verbatim so
  // existing clients keep working; new codes are snake_case.
  // Shipped with the unit-governance route and asserted by its clients.
  "LAST_CALIBRATION_APPROVER",
  // Shipped with the method routes' dimensional gate (DOM-10); the editor and
  // the integration specs branch on it.
  "DIMENSIONAL_ERROR",
  // The out-of-tolerance (§7.10) notification and impact-assessment routes.
  "ALREADY_ACKNOWLEDGED",
  "ASSESSMENT_SIGNED",
  "CONCLUSION_REQUIRED",
  // Shipped with public self-serve sign-up and asserted by the sign-up page.
  "ALREADY_REGISTERED",
  // The cloud approval route's role and roster refusals (`POST /jobs/:id/approve`),
  // asserted by the web approval dialog and the approval specs.
  "APPROVAL_ROLE_NOT_PERMITTED",
  "APPROVAL_ROSTER_EMPTY",
  "APPROVER_NOT_AUTHORIZED_SIGNATORY",
  // The out-of-tolerance flag (`POST /jobs/:id/flag-oot`).
  "JOB_NOT_APPROVED",
  "OOT_ALREADY_FLAGGED",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

const API_ERROR_CODE_SET: ReadonlySet<string> = new Set(API_ERROR_CODES);

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === "string" && API_ERROR_CODE_SET.has(value);
}

/**
 * HTTP statuses a `DomainError` may carry. 5xx stays a defect, not a domain
 * error. 410 and 429 are the public approval links' answers (a decided link,
 * a throttled code).
 */
export type ApiErrorStatus = 400 | 401 | 403 | 404 | 409 | 410 | 422 | 429;

export type ApiErrorJsonValue =
  | string
  | number
  | boolean
  | null
  | ApiErrorJsonValue[]
  | { [key: string]: ApiErrorJsonValue };

export type ApiErrorDetails = { [key: string]: ApiErrorJsonValue };

/** Body of every domain-failure response: `error` stays the pt-BR display text. */
export type ApiErrorBody = {
  error: string;
  code: ApiErrorCode;
  details?: ApiErrorDetails;
};
