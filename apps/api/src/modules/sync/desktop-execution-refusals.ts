import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  type StandardSnapshot,
} from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { buildUnitScopeCondition } from "../../lib/units";
import {
  type JobExecutionResult,
  type OfficialExecutionFailure,
} from "../jobs/submit-job";
import { type StandardsRefusal } from "../jobs/standards-judgement";
import { isIntegerNumber } from "./helpers";
import {
  type ApplyDesktopSyncEventInput,
  type ApplyDesktopSyncEventResult,
  buildStaleDesktopBaseConflict,
} from "./desktop-event-support";
import { collectCompositionStandardIds } from "./snapshot-parsers";

/** The sync outcome (rejection or reviewable conflict) of a command that did not write. */
export async function desktopExecutionRefusal(
  input: ApplyDesktopSyncEventInput,
  jobId: number,
  result: Exclude<JobExecutionResult, { status: "ok" }>,
  statusAtRead: string | null,
): Promise<ApplyDesktopSyncEventResult> {
  switch (result.status) {
    case "not_found":
      return {
        ok: false,
        code: "REMOTE_ENTITY_NOT_FOUND",
        reason: "Cloud job for desktop execution event was not found.",
      };
    case "illegal_transition":
      return {
        ok: false,
        code: "INVALID_STATUS_TRANSITION",
        reason: `Cannot apply desktop execution to job with status ${result.job.status}.`,
        conflict: {
          conflictType: "status_transition",
          remotePayload: {
            id: result.job.id,
            jobId: result.job.jobId,
            status: result.job.status,
            updatedAt:
              result.job.updatedAt instanceof Date
                ? result.job.updatedAt.toISOString()
                : result.job.updatedAt,
          },
        },
      };
    case "status_payload_mismatch":
      return {
        ok: false,
        code: "STATUS_PAYLOAD_MISMATCH",
        reason: `The desktop reported status ${result.claimedStatus}, but applying this event to a cloud job in ${result.job.status} lands it in ${result.expectedStatus}. The server derives the status from the job state machine and does not take the one the desktop sends.`,
      };
    case "precondition_failed":
      return { ok: false, code: result.code, reason: result.reason };
    case "invalid_performed_at":
      return {
        ok: false,
        code: "INVALID_DESKTOP_EVENT_PAYLOAD",
        reason: result.error.message,
      };
    case "standards_refused":
      return desktopStandardsRejection(result.refusal);
    case "asset_unavailable":
      return {
        ok: false,
        code:
          result.error.code === "asset_not_found"
            ? "ASSET_NOT_FOUND"
            : "ASSET_SPECIFICATION_MISSING",
        reason: result.error.message,
      };
    case "record_incomplete":
      return {
        ok: false,
        code: "CALIBRATION_RECORD_INCOMPLETE",
        reason: result.error.message,
      };
    case "official_execution_failed":
      return desktopOfficialExecutionRejection(result.failure);
    case "competence_missing":
      return {
        ok: false,
        code: "TECHNICIAN_COMPETENCE_MISSING",
        reason:
          "The technician assigned to the job has no active competence for this instrument type.",
      };
    case "concurrent_update":
      return await rejectLostDesktopExecutionRace(input, jobId, statusAtRead);
  }
}

/** The sync rejection for a job whose frozen compiled method could not be run. */
function desktopOfficialExecutionRejection(failure: OfficialExecutionFailure): {
  ok: false;
  code: string;
  reason: string;
} {
  switch (failure.kind) {
    case "snapshot_required":
      return {
        ok: false,
        code: "COMPILED_METHOD_SNAPSHOT_INVALID",
        reason:
          "Compiled method snapshot is required for desktop execution sync.",
      };
    case "snapshot_invalid":
      return {
        ok: false,
        code: "COMPILED_METHOD_SNAPSHOT_INVALID",
        reason: "Compiled method snapshot has an invalid shape.",
      };
    case "snapshot_mismatch":
      return {
        ok: false,
        code: "COMPILED_METHOD_SNAPSHOT_INVALID",
        reason: "Compiled method snapshot does not match job metadata.",
      };
    case "execution_failed":
      return {
        ok: false,
        code: "OFFICIAL_EXECUTION_FAILED",
        reason:
          failure.diagnostics.find((item) => item.severity === "error")
            ?.message ?? "Cloud verification of desktop execution failed.",
      };
  }
}

/**
 * The job changed (status, or organization) between the apply's read and its
 * compare-and-set write: reject exactly as the pre-check would have had it seen
 * the new row, so the desktop keeps the event queued and shows the same
 * status_transition conflict.
 */
async function rejectLostDesktopExecutionRace(
  input: ApplyDesktopSyncEventInput,
  jobId: number,
  statusAtRead: string | null,
): Promise<ApplyDesktopSyncEventResult> {
  const [current] = await db
    .select()
    .from(calibrationJob)
    .where(
      and(
        eq(calibrationJob.id, jobId),
        eq(calibrationJob.organizationId, input.memberData.organizationId),
        buildUnitScopeCondition(calibrationJob.unitId, input.memberData),
      ),
    )
    .limit(1);

  if (!current) {
    return {
      ok: false,
      code: "REMOTE_ENTITY_NOT_FOUND",
      reason: "Cloud job for desktop execution event was not found.",
    };
  }

  // The status is what the command read: the job changed without changing
  // status (someone else saved it between the stale-base check and the write).
  // The same concurrent_update conflict the check itself answers, with nothing
  // written.
  const baseUpdatedAt = input.event.baseUpdatedAt;
  if (
    current.status === statusAtRead &&
    typeof baseUpdatedAt === "string" &&
    current.updatedAt instanceof Date
  ) {
    return buildStaleDesktopBaseConflict({
      entity: "calibration_job",
      id: current.id,
      serverUpdatedAtIso: current.updatedAt.toISOString(),
      baseUpdatedAt,
      remoteFields: {
        jobId: current.jobId,
        status: current.status,
        data: current.data,
        methodDeviations: current.methodDeviations,
      },
    });
  }

  return {
    ok: false,
    code: "INVALID_STATUS_TRANSITION",
    reason: `The cloud job changed status to ${current.status} while the desktop execution was being applied.`,
    conflict: {
      conflictType: "status_transition",
      remotePayload: {
        id: current.id,
        jobId: current.jobId,
        status: current.status,
        updatedAt:
          current.updatedAt instanceof Date
            ? current.updatedAt.toISOString()
            : current.updatedAt,
      },
    },
  };
}

type DesktopPayloadRefusal = { code: string; reason: string };

/**
 * The checks of a desktop execution payload that need no database: the standard
 * snapshot is internally consistent and carries what the data uses (mass
 * composition items must be in the snapshot, with certified values). The
 * judgement of the standards themselves (active, not deleted, certificate
 * valid on the performed day) is the cloud's one judgement, run by the
 * submit/execute command.
 */
export function validateDesktopExecutionStandardsPayload(
  standardsSnapshot: StandardSnapshot[] | null,
  data: Record<string, unknown>,
): DesktopPayloadRefusal | null {
  const compositionStandardIds = collectCompositionStandardIds(data);

  if (!standardsSnapshot || standardsSnapshot.length === 0) {
    if (compositionStandardIds.length > 0) {
      return {
        code: "INVALID_STANDARD_SNAPSHOT",
        reason: `Desktop execution mass composition references standards missing from standardsSnapshot: ${compositionStandardIds.join(", ")}.`,
      };
    }
    return null;
  }

  const selectedStandardIds = standardsSnapshot.map((standard) => standard.id);
  const invalidIds = selectedStandardIds.filter((id) => !isIntegerNumber(id));

  if (invalidIds.length > 0) {
    return {
      code: "INVALID_STANDARD_SNAPSHOT",
      reason: "Desktop execution standard snapshot contains invalid ids.",
    };
  }

  const snapshotsById = new Map(
    standardsSnapshot
      .filter((standard) => isIntegerNumber(standard.id))
      .map((standard) => [standard.id, standard]),
  );
  const compositionIdsMissingSnapshot = compositionStandardIds.filter(
    (standardId) => !snapshotsById.has(standardId),
  );
  if (compositionIdsMissingSnapshot.length > 0) {
    return {
      code: "INVALID_STANDARD_SNAPSHOT",
      reason: `Desktop execution mass composition references standards missing from standardsSnapshot: ${compositionIdsMissingSnapshot.join(", ")}.`,
    };
  }

  const compositionIdsMissingCertifiedValues = compositionStandardIds.filter(
    (standardId) =>
      !((snapshotsById.get(standardId)?.certifiedValues?.length ?? 0) > 0),
  );
  if (compositionIdsMissingCertifiedValues.length > 0) {
    return {
      code: "STANDARD_CERTIFIED_VALUES_MISSING",
      reason: `Desktop execution mass composition references standards without certified values: ${compositionIdsMissingCertifiedValues.join(", ")}.`,
    };
  }

  return null;
}

/** The sync rejection (code + reason) the desktop sees for a judgement refusal. */
function desktopStandardsRejection(refusal: StandardsRefusal): {
  ok: false;
  code: string;
  reason: string;
} {
  const names = refusal.standardNames.join(", ");
  switch (refusal.code) {
    case "standard_not_found":
      return {
        ok: false,
        code: "STANDARD_SCOPE_MISMATCH",
        reason: `Desktop execution references standards that are missing or outside scope: ${refusal.standardIds.join(", ")}.`,
      };
    case "standard_deleted":
      return {
        ok: false,
        code: "STANDARD_SCOPE_MISMATCH",
        reason: `Desktop execution references standards that were deleted: ${names}.`,
      };
    case "standard_inactive":
      return {
        ok: false,
        code: "STANDARD_NOT_ACTIVE",
        reason: `Desktop execution references inactive standards: ${names}.`,
      };
    case "standard_expired":
      return {
        ok: false,
        code: "STANDARD_EXPIRED",
        reason: `Desktop execution references expired standards: ${names}.`,
      };
    case "standard_backdate_reason_required":
      return {
        ok: false,
        code: "STANDARD_BACKDATE_REASON_REQUIRED",
        reason: `The certificate of ${names} expired after the performed date; a justification for the back-dated record is required.`,
      };
  }
}
