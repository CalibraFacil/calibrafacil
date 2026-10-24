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

  // Job status machine.
  "job_status_conflict",
  "job_not_found",
  "job_not_cancelable",
  "job_not_submittable",
  "job_not_rejectable",
  "job_not_executable",
  "job_not_editable",
  "job_not_assignable",
  "job_not_amendable",
  "job_already_amended",
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
  "performed_at_invalid",
  "performed_at_future",
  "backdate_reason_required",
  "asset_specification_missing",
  "calibration_record_incomplete",
  "official_execution_failed",
  "technician_competence_missing",
  "certificate_not_found",
  "certificate_not_ready",

  // Customers, assets, units, services.
  "customer_not_found",
  "customer_create_failed",
  "asset_not_found",
  "asset_type_not_found",
  "asset_tag_conflict",
  "asset_base_measurement_unit_required",
  "invalid_assets",
  "unit_not_found",
  "unit_asset_mismatch",
  "service_not_found",
  "technician_not_found",

  // Service requests.
  "request_not_found",
  "request_not_editable",
  "request_not_cancelable",
  "multi_unit_request_not_allowed",

  // Records retention (decision Q16): organization lifecycle and the
  // customers / API keys that depend on it.
  "organization_confirmation_mismatch",
  "organization_already_deleted",
  "organization_suspended",
  "organization_deleted",
  "customer_has_retained_records",

  // Webhooks.
  "webhook_not_found",
  "webhook_delivery_not_found",

  // LEGACY (upper-case): shipped before this registry existed and still
  // asserted by clients/tests of the job and visit routes. Kept verbatim so
  // existing clients keep working; new code must use `job_status_conflict`.
  "JOB_STATUS_CONFLICT",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

const API_ERROR_CODE_SET: ReadonlySet<string> = new Set(API_ERROR_CODES);

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === "string" && API_ERROR_CODE_SET.has(value);
}

/** HTTP statuses a `DomainError` may carry. 5xx stays a defect, not a domain error. */
export type ApiErrorStatus = 400 | 401 | 403 | 404 | 409 | 422;

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
