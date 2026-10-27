import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ClientIpContext } from "../../lib/client-ip";
import {
  buildPublicApiError,
  getPublicApiRequestIp,
} from "../../lib/public-api";
import { type ApiKeyAuthVariables } from "../../middleware/api-key-auth";
import {
  type JobExecutionActor,
  type JobExecutionResult,
} from "../../modules/jobs/submit-job";

/**
 * Body of the 409 returned when a job write's compare-and-set matched no row:
 * the job changed status (or left the key's organization) between the route's
 * read and its write. Same code and message as the cancel route.
 */
export function jobStatusConflictBody() {
  return buildPublicApiError({
    code: "job_status_conflict",
    message:
      "O status da OS mudou durante a operação. Recarregue e tente novamente.",
  });
}

/** The key's creator is the accountable person; the key itself is recorded. */
export function publicApiJobActor(
  apiKey: ApiKeyAuthVariables["apiKey"],
  c: ClientIpContext,
) {
  return {
    kind: "api_key",
    userId: apiKey.createdBy,
    apiKey: { id: apiKey.id, name: apiKey.name, keyPrefix: apiKey.keyPrefix },
    ipAddress: getPublicApiRequestIp(c),
  } satisfies JobExecutionActor;
}

/**
 * The public API's answer to a submit/results command that did not write: the
 * command's own refusal code and message in the v2 error envelope, with the
 * status the v2 contract has always used for it (409 for a job that cannot
 * take the operation, 422 for a rejected standard).
 */
export function publicApiJobExecutionRefusal(
  result: Exclude<JobExecutionResult, { status: "ok" }>,
  illegalTransitionMessage: string,
): { status: ContentfulStatusCode; body: Record<string, unknown> } {
  switch (result.status) {
    case "not_found":
      return {
        status: 404,
        body: buildPublicApiError({
          code: "job_not_found",
          message: "OS não encontrada",
        }),
      };
    case "concurrent_update":
      return { status: 409, body: jobStatusConflictBody() };
    case "illegal_transition":
      return {
        status: 409,
        body: buildPublicApiError({
          code: result.error.code,
          message: illegalTransitionMessage,
        }),
      };
    case "status_payload_mismatch":
      return {
        status: 409,
        body: buildPublicApiError({
          code: result.error.code,
          message: result.error.message,
        }),
      };
    case "standards_refused":
      return {
        status: 422,
        body: buildPublicApiError({
          code: result.error.code,
          message: result.error.message,
          details: { standardIds: result.refusal.standardIds },
        }),
      };
    case "official_execution_failed":
      return {
        status: 422,
        body: buildPublicApiError({
          code: result.error.code,
          message: result.error.message,
          details: { diagnostics: result.failure.diagnostics },
        }),
      };
    case "competence_missing":
      return {
        status: 422,
        body: buildPublicApiError({
          code: result.error.code,
          message: result.error.message,
        }),
      };
    case "precondition_failed":
      return {
        status: 400,
        body: buildPublicApiError({
          code: "invalid_request",
          message: result.reason,
        }),
      };
    case "invalid_performed_at":
    case "asset_unavailable":
    case "record_incomplete":
      return {
        status: 400,
        body: buildPublicApiError({
          code: result.error.code,
          message: result.error.message,
        }),
      };
  }
}
