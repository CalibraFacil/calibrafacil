import { desktopEventCarriesCalibrationRecordRule } from "@calibra-facil/schemas";
import {
  executeJob,
  submitJob,
  type FrozenExecutionSnapshots,
  type JobExecutionCommand,
} from "../jobs/submit-job";
import { type RefusedEventResult } from "./event-transaction";
import {
  asRecord,
  getNullableString,
  getNumber,
  getRecordOrNull,
} from "./helpers";
import {
  type ApplyDesktopSyncEventInput,
  type ApplyDesktopSyncEventResult,
  buildStaleDesktopBaseConflict,
  detectStaleDesktopBase,
  resolveDesktopPerformedAt,
} from "./desktop-event-support";
import {
  findDesktopSyncRemoteEntityId,
  writeDesktopSyncAudit,
} from "./desktop-sync-support";
import {
  getCalibrationLocationSnapshotOrNull,
  getCalibrationPhaseSnapshotOrNull,
  getEnvironmentalSnapshotOrNull,
  getJobStatus,
  getMethodDeviationsOrNull,
  getStandardSnapshotsResult,
  hasOwn,
} from "./snapshot-parsers";
import {
  desktopExecutionRefusal,
  validateDesktopExecutionStandardsPayload,
} from "./desktop-execution-refusals";

export async function applyLocalJobExecution(
  input: ApplyDesktopSyncEventInput,
  actorUserId: string,
): Promise<ApplyDesktopSyncEventResult> {
  const payload = asRecord(input.event.payload);
  const mappedRemoteEntityId = await findDesktopSyncRemoteEntityId(
    input.memberData.organizationId,
    input.event.entityId,
  );
  const remoteEntityId =
    typeof mappedRemoteEntityId === "number"
      ? mappedRemoteEntityId
      : getNumber(payload, "remoteId");

  if (typeof remoteEntityId !== "number") {
    return {
      ok: false,
      code: "REMOTE_ENTITY_MAPPING_MISSING",
      reason: "Desktop execution event has no synced cloud job mapping.",
    };
  }

  // The payload is read here and handed to the one submit/execute command as
  // what the desktop froze offline. The command owns every decision (the
  // transition, the status the payload claims, the performed date, the
  // standards, the official execution, the compare-and-set write); this only
  // translates the event and maps each result to a sync outcome.
  const isSubmit = input.event.operation === "submit_local_execution";
  const standardsSnapshotResult = hasOwn(payload, "standardsSnapshot")
    ? getStandardSnapshotsResult(payload, "standardsSnapshot")
    : null;
  const frozen: FrozenExecutionSnapshots = {
    ...(standardsSnapshotResult?.ok
      ? { standards: { value: standardsSnapshotResult.value } }
      : {}),
    ...(hasOwn(payload, "environmentalSnapshot")
      ? {
          environmental: {
            value: getEnvironmentalSnapshotOrNull(
              payload,
              "environmentalSnapshot",
            ),
          },
        }
      : {}),
    ...(hasOwn(payload, "calibrationLocationSnapshot")
      ? {
          calibrationLocation: {
            value: getCalibrationLocationSnapshotOrNull(
              payload,
              "calibrationLocationSnapshot",
            ),
          },
        }
      : {}),
    ...(hasOwn(payload, "calibrationPhaseSnapshot")
      ? {
          calibrationPhases: {
            value: getCalibrationPhaseSnapshotOrNull(
              payload,
              "calibrationPhaseSnapshot",
            ),
          },
        }
      : {}),
  };
  const nextData = getRecordOrNull(payload, "data") ?? {};

  const stale: {
    conflict: RefusedEventResult | null;
    /** The job as the command read it (set once its transition is legal). */
    read: { status: string } | null;
  } = { conflict: null, read: null };

  const execution: JobExecutionCommand = {
    actor: { kind: "desktop_session", userId: actorUserId },
    jobId: remoteEntityId,
    organizationId: input.memberData.organizationId,
    unitScope: input.memberData,
    data: nextData,
    // What the desktop computed: never stored, only recorded.
    clientResults: getRecordOrNull(payload, "results"),
    performedAt: getNullableString(payload, "performedAt")?.trim() || null,
    backdateReason:
      getNullableString(payload, "backdateReason")?.trim() || null,
    // The backdate rule counts from when the technician recorded the
    // submission, not from the sync: a laptop offline for ten days must not
    // push a same-day entry past the threshold. Clamped to the server clock.
    recordedAt: resolveDesktopPerformedAt(input.event.occurredAt, new Date()),
    // §7.8.2.1(n). Absent means "not edited offline" and must not clear a
    // value the cloud already holds; an explicit null or empty string clears it.
    methodDeviations: hasOwn(payload, "methodDeviations")
      ? getMethodDeviationsOrNull(payload, "methodDeviations")
      : undefined,
    frozen,
    // A submit from a build that enforced the calibration record offline is
    // held to the rule here too; one from a build before it (no payload
    // version) is applied as before so an upgrade does not dead-letter it.
    // That exemption ends once a minimum desktop version is configured (Q28):
    // every desktop that reaches this point is then at or above it.
    legacyUnvalidatedRecord:
      input.minimumDesktopVersion === undefined &&
      !desktopEventCarriesCalibrationRecordRule(payload),
    // The desktop reports the status its own store moved the job to; the
    // server derives the target from the transition table and refuses a
    // payload that disagrees (Q20).
    claimedStatus: getJobStatus(payload, "status"),
    // With a base version, the write holds only if the job is still what the
    // stale-base check saw (a content-only write in between is a conflict).
    requireUnchangedSinceRead: Number.isFinite(
      Date.parse(input.event.baseUpdatedAt ?? ""),
    ),
    // Payload integrity, checked once the job is loaded and its transition is
    // known to be legal: a malformed snapshot, or data that uses standards the
    // snapshot does not carry.
    precondition: (job) => {
      // Stale base (REQ-SP-5): the cloud job moved since the desktop pulled it
      // (someone else saved, reassigned or changed it). Answered as a
      // reviewable conflict; applying the desktop's execution would overwrite
      // that change.
      stale.read = { status: job.status };
      const staleBase = detectStaleJobExecutionBase(input, job);
      if (staleBase) {
        stale.conflict = staleBase;
        return { code: staleBase.code, reason: staleBase.reason };
      }
      if (standardsSnapshotResult && !standardsSnapshotResult.ok) {
        return {
          code: "INVALID_STANDARD_SNAPSHOT",
          reason: standardsSnapshotResult.reason,
        };
      }
      return validateDesktopExecutionStandardsPayload(
        frozen.standards ? frozen.standards.value : job.standardsSnapshot,
        nextData,
      );
    },
  };

  const result = isSubmit
    ? await submitJob(execution)
    : await executeJob(execution);

  if (result.status === "precondition_failed" && stale.conflict) {
    return stale.conflict;
  }
  if (result.status !== "ok") {
    return await desktopExecutionRefusal(
      input,
      remoteEntityId,
      result,
      stale.read?.status ?? null,
    );
  }

  const updated = result.job;
  await writeDesktopSyncAudit(input, actorUserId, {
    remoteEntityId: updated.id,
    remoteJobId: updated.jobId,
  });

  return {
    ok: true,
    remoteEntityId: updated.id,
    remoteEntity: {
      id: updated.id,
      jobId: updated.jobId,
      status: updated.status,
      performedAt: updated.performedAt?.toISOString?.() ?? null,
      // The desktop's base for its next edit of this job: what it must send as
      // `baseUpdatedAt` so its own write is not mistaken for somebody else's.
      updatedAt: updated.updatedAt?.toISOString?.(),
    },
  };
}

/**
 * The stale-base check of a job execution (REQ-SP-5).
 *
 * The base version of a job is its cloud `updatedAt` as the desktop last saw
 * it: captured when the job was pulled, and moved forward each time the cloud
 * accepts one of the desktop's own executions (the accept answer carries the
 * new value, `remoteEntity.updatedAt`). The event carries it as
 * `baseUpdatedAt`. Any write to the job moves `updatedAt`, so a cloud value
 * after the base means the job changed since the desktop's copy: its status,
 * its execution data, its assignment.
 *
 * Not stale (nothing to check or nothing foreign): no base, an unreadable
 * base, a cloud value at or before the base, or a cloud value this very push
 * request left the job at (an earlier event of the same desktop, in this
 * batch, made against the same pulled base).
 */
function detectStaleJobExecutionBase(
  input: ApplyDesktopSyncEventInput,
  job: {
    id: number;
    jobId: string;
    status: string;
    data: unknown;
    methodDeviations: string | null;
    updatedAt: Date | string | null;
  },
): RefusedEventResult | null {
  const stale = detectStaleDesktopBase({
    baseUpdatedAt: input.event.baseUpdatedAt,
    serverUpdatedAt: job.updatedAt,
  });
  if (!stale.diverged) return null;

  const ownWrite = input.batch.jobUpdatedAtMs.get(job.id);
  if (
    ownWrite !== undefined &&
    ownWrite === Date.parse(stale.serverUpdatedAtIso)
  ) {
    return null;
  }

  const conflict = buildStaleDesktopBaseConflict({
    entity: "calibration_job",
    id: job.id,
    serverUpdatedAtIso: stale.serverUpdatedAtIso,
    baseUpdatedAt: stale.baseUpdatedAt,
    remoteFields: {
      jobId: job.jobId,
      status: job.status,
      data: job.data,
      methodDeviations: job.methodDeviations,
    },
  });
  return conflict.ok ? null : conflict;
}
