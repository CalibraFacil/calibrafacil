import type { ApiErrorCode } from "@calibra-facil/contracts";
import type { JobStatus } from "@calibra-facil/db/schema";
import { DomainError } from "../../lib/domain-errors";

type VisitLike = {
  status: string;
  customerId: number;
};

type AssetLike = {
  customerId: number;
};

type JobLike = {
  status: JobStatus;
  visitId: number | null;
};

type GuardOk = { ok: true };
type GuardError = {
  ok: false;
  status: 400 | 404 | 409;
  code: ApiErrorCode;
  body: string;
};
type GuardResult = GuardOk | GuardError;

/**
 * REQ-VISITJOB-003: Guard that the visit is in PROPOSED status before adding a job.
 * Returns a typed error result when the visit is not PROPOSED.
 */
export function canAddJobToVisit(visit: VisitLike): GuardResult {
  if (visit.status !== "PROPOSED") {
    return {
      ok: false,
      status: 409,
      code: "visit_not_proposed",
      body: "Instrumentos so podem ser adicionados a visitas com status PROPOSED",
    };
  }
  return { ok: true };
}

/**
 * REQ-VISITJOB-004: Guard that the asset belongs to the visit's customer.
 * Returns a typed error result when the asset's customer does not match.
 */
export function assertAssetBelongsToVisitCustomer(
  asset: AssetLike,
  visit: VisitLike,
): GuardResult {
  if (asset.customerId !== visit.customerId) {
    return {
      ok: false,
      status: 400,
      code: "invalid_request",
      body: "Ativo nao pertence ao cliente da visita",
    };
  }
  return { ok: true };
}

/**
 * REQ-VISITJOB-006,007,008,009: Guards for the remove-job operation.
 * Checks visit status, job ownership, and job status before canceling.
 */
export function resolveVisitJobRemoval({
  visitStatus,
  job,
  visitId,
}: {
  visitStatus: string;
  job: JobLike | null;
  visitId: number;
}): GuardResult {
  // REQ-VISITJOB-008: non-PROPOSED visit → 409
  if (visitStatus !== "PROPOSED") {
    return {
      ok: false,
      status: 409,
      code: "visit_not_proposed",
      body: "Instrumentos so podem ser removidos de visitas com status PROPOSED",
    };
  }

  // REQ-VISITJOB-009: job not found or belongs to different visit → 404
  if (!job || job.visitId !== visitId) {
    return {
      ok: false,
      status: 404,
      code: "job_not_found",
      body: "Job nao encontrado nesta visita",
    };
  }

  // REQ-VISITJOB-007: job is not in DRAFT status → 409
  if (job.status !== "DRAFT") {
    return {
      ok: false,
      status: 409,
      code: "job_not_cancelable",
      body: "Apenas jobs com status DRAFT podem ser removidos da visita",
    };
  }

  return { ok: true };
}

/** Throws a refused guard as the domain error `app.onError` renders. */
export function assertGuard(guard: GuardResult): void {
  if (!guard.ok) {
    throw new DomainError({
      code: guard.code,
      status: guard.status,
      message: guard.body,
    });
  }
}
