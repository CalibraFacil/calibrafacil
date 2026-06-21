import type { JobStatus } from "@calibra-facil/db/schema";

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
type GuardError = { ok: false; status: 400 | 404 | 409; body: string };
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
      body: "Instrumentos so podem ser removidos de visitas com status PROPOSED",
    };
  }

  // REQ-VISITJOB-009: job not found or belongs to different visit → 404
  if (!job || job.visitId !== visitId) {
    return {
      ok: false,
      status: 404,
      body: "Job nao encontrado nesta visita",
    };
  }

  // REQ-VISITJOB-007: job is not in DRAFT status → 409
  if (job.status !== "DRAFT") {
    return {
      ok: false,
      status: 409,
      body: "Apenas jobs com status DRAFT podem ser removidos da visita",
    };
  }

  return { ok: true };
}
