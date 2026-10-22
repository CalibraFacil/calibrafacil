import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  jobAuditLog,
  referenceStandard,
  type AssetSnapshot,
  type CalibrationLocationSnapshot,
  type CalibrationPhaseSnapshot,
  type EnvironmentalSnapshot,
  type JobStatus,
  type StandardSnapshot,
} from "@calibra-facil/db/schema";
import {
  resolveExecutionPerformedAt,
  validateCalibrationRecordForSubmit,
  type CalibrationLocationInput,
  type CalibrationPhaseInput,
  type EnvironmentalDataInput,
  type StandardsJudgementMode,
} from "@calibra-facil/schemas";
import { targetOf } from "@calibra-facil/schemas/job-transitions";
import { normalizeMethodDataForStorage } from "@calibra-facil/shared/units";
import type { MethodDiagnostic } from "@calibra-facil/method-definition";
import { and, eq } from "drizzle-orm";
import {
  invalid,
  type DomainError,
  unprocessable,
} from "../../lib/domain-errors";
import { syncJobStandardLinks } from "../../lib/job-standards";
import { reconcileMethodSnapshotEngine } from "../../lib/method-snapshot-engine";
import { classifyJobScopeCompliance } from "../../lib/scope-compliance";
import { buildUnitScopeCondition } from "../../lib/units";
import { syncVisitStatusFromJobs } from "../../lib/visits";
import {
  buildCalibrationLocationSnapshot,
  buildCalibrationPhaseSnapshot,
  buildEnvironmentalSnapshot,
  buildStandardsSnapshot,
  resolveAssetSnapshot,
  standardsPerformedAt,
} from "./execution-snapshots";
import {
  jobActorAuditFields,
  loadScopedJob,
  type JobActor,
  type JobRow,
  type UnitScope,
} from "./job-actor";
import { technicianHasCompetence } from "./technician-assignment";
import { methodInputFieldsFromSnapshot, stripAssetSpecData } from "./helpers";
import {
  createMethodExecutionEngine,
  executeOfficialCompiledSnapshot,
  type CompiledSnapshotFailureKind,
} from "./official-execution";
import {
  judgeSnapshotStandards,
  snapshotStandardIds,
  standardsRefusalDomainError,
  type StandardsRefusal,
} from "./standards-judgement";

/**
 * Submit and execute (save the worksheet / record results) a calibration job:
 * the ONE implementation behind every entry point (cloud routes, public API
 * v2, desktop sync apply). Route adapters only build the actor, translate the
 * transport's payload into this command and map each result status back to a
 * response. Everything that decides whether the job may move is here:
 *
 *   1. load the job (organization + unit scope)
 *   2. the transition table (`submit` / `execute`) and, for the desktop, the
 *      status its payload claims (Q20: the server derives the target)
 *   3. when the work was performed (`resolveExecutionPerformedAt`: not in the
 *      future, a written reason beyond 7 days)
 *   4. the reference standards (`judgeSnapshotStandards`, the one judgement)
 *   5. the asset snapshot (and its required specifications)
 *   6. environment, calibration location and phases
 *   7. the official compiled execution: `results` are RECOMPUTED from `data`;
 *      the server never stores results a client computed
 *   8. a submit only: the technician's competence and the accredited-scope
 *      (CMC) classification
 *   9. the compare-and-set write and its audit row, in one transaction
 *
 * A refusal writes nothing. Concurrency: the write carries
 * `WHERE id AND organization_id AND status = <status read>`, so a job that
 * moved (or left the organization) between the read and the write matches no
 * row and yields `concurrent_update`.
 */

const SUBMIT_BACKDATE_NOTE = "Registro retroativo";

/** WHO is submitting / saving: see `JobActor`. */
export type JobExecutionActor = JobActor;

/**
 * Snapshots a desktop froze offline and sends whole. A key that is present
 * replaces the job's value (null clears it); an absent key leaves it alone.
 * Cloud callers send the inputs the snapshots are built from instead.
 */
export type FrozenExecutionSnapshots = {
  standards?: { value: StandardSnapshot[] | null };
  environmental?: { value: EnvironmentalSnapshot | null };
  calibrationLocation?: { value: CalibrationLocationSnapshot | null };
  calibrationPhases?: { value: CalibrationPhaseSnapshot | null };
};

export type JobExecutionCommand = {
  actor: JobExecutionActor;
  jobId: number;
  organizationId: string;
  /**
   * The units the caller may act in; `null` is organization-wide (an API key
   * has no unit scope). Never a client-supplied value.
   */
  unitScope: UnitScope | null;
  /** The worksheet data. Results are computed from it, never taken. */
  data: Record<string, unknown>;
  /** What the client says the results are: ignored, kept in the audit row. */
  clientResults?: Record<string, unknown> | null;
  performedAt?: string | null;
  backdateReason?: string | null;
  /**
   * When the caller recorded the work, if that is not now (an offline
   * submission recorded days before it synced). The backdate rule is measured
   * from it. Defaults to now.
   */
  recordedAt?: Date;
  /** §7.8.2.1(n). `undefined` leaves the stored value untouched. */
  methodDeviations?: string | null;
  selectedStandardIds?: number[];
  environment?: EnvironmentalDataInput;
  calibrationLocation?: CalibrationLocationInput;
  calibrationPhases?: CalibrationPhaseInput;
  frozen?: FrozenExecutionSnapshots;
  /**
   * A desktop submit written by a build that predates the offline calibration
   * record rule (no location, no phase reasons collected): the only submit that
   * is not held to it. Ignored for every other actor.
   */
  legacyUnvalidatedRecord?: boolean;
  /**
   * The status the caller's payload says the job lands in (the desktop sends
   * its own). It is only checked against the transition table, never written:
   * a payload that disagrees is refused (Q20).
   */
  claimedStatus?: JobStatus | null;
  /**
   * A caller-specific check on the loaded job, run once its transition is
   * known to be legal and before anything else is read or written (the desktop
   * uses it for payload integrity that depends on the job's stored snapshots).
   * The command does not interpret the code; it is handed back unchanged.
   */
  precondition?: (job: JobRow) => { code: string; reason: string } | null;
};

type RunCommand = JobExecutionCommand & { command: "submit" | "execute" };

export type OfficialExecutionFailure = {
  kind: CompiledSnapshotFailureKind | "execution_failed";
  message: string;
  diagnostics: MethodDiagnostic[];
};

export type JobExecutionResult =
  | {
      status: "ok";
      job: JobRow;
      previousStatus: JobStatus;
    }
  | { status: "not_found" }
  | {
      status: "illegal_transition";
      currentStatus: JobStatus;
      /** The job as read, for a caller that reports it back (a sync conflict). */
      job: JobRow;
      error: DomainError;
    }
  | {
      /** The payload's status is not where the transition table lands the job (Q20). */
      status: "status_payload_mismatch";
      currentStatus: JobStatus;
      job: JobRow;
      claimedStatus: JobStatus;
      expectedStatus: JobStatus;
      error: DomainError;
    }
  | {
      /** The caller's own precondition on the loaded job refused (`precondition`). */
      status: "precondition_failed";
      code: string;
      reason: string;
    }
  | {
      status: "invalid_performed_at";
      reason: "invalid" | "future" | "reason_required";
      error: DomainError;
    }
  | {
      status: "standards_refused";
      refusal: StandardsRefusal;
      error: DomainError;
    }
  | { status: "asset_unavailable"; error: DomainError }
  | { status: "record_incomplete"; error: DomainError }
  | {
      status: "official_execution_failed";
      failure: OfficialExecutionFailure;
      error: DomainError;
    }
  | { status: "competence_missing"; error: DomainError }
  /**
   * Compare-and-set lost: the job left the status (or organization) this
   * command was evaluated against between the read and the write. Nothing was
   * written.
   */
  | { status: "concurrent_update" };

/** Save the worksheet / record results. A REJECTED job stays REJECTED (Q18). */
export function executeJob(
  command: JobExecutionCommand,
): Promise<JobExecutionResult> {
  return runJobExecution({ ...command, command: "execute" });
}

/** Submit the job for review: results recomputed, every release gate run. */
export function submitJob(
  command: JobExecutionCommand,
): Promise<JobExecutionResult> {
  return runJobExecution({ ...command, command: "submit" });
}

function jobExecutionStandardsMode(
  actor: JobExecutionActor,
  explicitPerformedAt: boolean,
): StandardsJudgementMode {
  if (actor.kind === "desktop_session") {
    return explicitPerformedAt ? "desktop_explicit" : "desktop_legacy";
  }
  return "cloud";
}

type PerformedAtResolution =
  | { ok: true; performedAt: Date | null; backdateDays: number }
  | { ok: false; refusal: JobExecutionResult };

/**
 * When the calibration was performed. A submit records it under
 * `resolveExecutionPerformedAt`; a draft save only remembers a parseable date
 * (the strict rules gate the submit, so autosave never loses readings).
 */
function resolvePerformedAt(
  command: RunCommand,
  now: Date,
  recordedAt: Date,
): PerformedAtResolution {
  const raw = command.performedAt?.trim() || null;

  if (command.command !== "submit") {
    const parsed = raw ? new Date(raw) : null;
    return {
      ok: true,
      performedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
      backdateDays: 0,
    };
  }

  if (!raw) {
    return { ok: true, performedAt: recordedAt, backdateDays: 0 };
  }

  // The backdate rule counts from when the work was recorded; an entry later
  // than that but not in the future is taken as recorded then.
  const parsed = new Date(raw);
  const reference =
    parsed.getTime() > recordedAt.getTime() && parsed.getTime() <= now.getTime()
      ? parsed
      : recordedAt;
  const resolved = resolveExecutionPerformedAt({
    performedAt: raw,
    backdateReason: command.backdateReason,
    now: reference,
  });
  if (resolved.ok) {
    return {
      ok: true,
      performedAt: resolved.performedAt,
      backdateDays: resolved.backdateDays,
    };
  }

  const error =
    resolved.code === "invalid"
      ? invalid("performed_at_invalid", resolved.message)
      : resolved.code === "future"
        ? invalid("performed_at_future", resolved.message)
        : invalid("backdate_reason_required", resolved.message);
  return {
    ok: false,
    refusal: { status: "invalid_performed_at", reason: resolved.code, error },
  };
}

async function runJobExecution(
  command: RunCommand,
): Promise<JobExecutionResult> {
  const { actor, organizationId } = command;
  const isSubmit = command.command === "submit";
  const isDesktop = actor.kind === "desktop_session";

  // 1. Facts: the job, inside the caller's organization and unit scope.
  const existing = await loadScopedJob({
    jobId: command.jobId,
    organizationId,
    unitScope: command.unitScope,
  });
  if (!existing) return { status: "not_found" };

  // 2. The transition table.
  const nextStatus = targetOf(existing.status, command.command);
  if (nextStatus === null) {
    return {
      status: "illegal_transition",
      currentStatus: existing.status,
      job: existing,
      error: isSubmit
        ? invalid(
            "job_not_submittable",
            `Nao e possivel submeter um job com status ${existing.status}`,
          )
        : invalid(
            "job_not_executable",
            `Nao e possivel executar um job com status ${existing.status}`,
          ),
    };
  }
  if (command.claimedStatus && command.claimedStatus !== nextStatus) {
    return {
      status: "status_payload_mismatch",
      currentStatus: existing.status,
      job: existing,
      claimedStatus: command.claimedStatus,
      expectedStatus: nextStatus,
      error: invalid(
        "job_status_payload_mismatch",
        `O status enviado (${command.claimedStatus}) diverge do status que a operacao produz (${nextStatus}) para um job em ${existing.status}`,
      ),
    };
  }

  const unmet = command.precondition?.(existing);
  if (unmet) {
    return {
      status: "precondition_failed",
      code: unmet.code,
      reason: unmet.reason,
    };
  }

  // 3. When the work was performed.
  const now = new Date();
  const recordedAt = command.recordedAt ?? now;
  const performed = resolvePerformedAt(command, now, recordedAt);
  if (!performed.ok) return performed.refusal;
  const performedAt = performed.performedAt;
  const backdateReason = command.backdateReason?.trim() || null;

  // 4. Reference standards.
  let nextStandardsSnapshot: StandardSnapshot[] | null | undefined =
    existing.standardsSnapshot;
  let standardsTouched = false;
  if (command.frozen?.standards) {
    nextStandardsSnapshot = command.frozen.standards.value;
    standardsTouched = true;
  } else {
    const built = await buildStandardsSnapshot(
      command.selectedStandardIds,
      organizationId,
      existing.unitId,
      // The date the work is recorded at (a draft keeps the one already
      // saved): a standard is valid through its certificate day, judged on the
      // laboratory day the calibration was performed.
      standardsPerformedAt(
        command.performedAt,
        isSubmit ? null : existing.performedAt,
      ),
    );
    if (!built.ok) {
      return {
        status: "standards_refused",
        refusal: built.refusal,
        error: standardsRefusalDomainError(built.refusal),
      };
    }
    if (built.snapshot !== undefined) {
      nextStandardsSnapshot = built.snapshot;
      standardsTouched = true;
    }
  }

  // A submit re-judges EVERY standard of the final snapshot (whether or not
  // this request names standards), at the final performed day, from the
  // standards table. A desktop save is judged too: it sends the whole snapshot.
  let standardsJudgement: Extract<
    Awaited<ReturnType<typeof judgeSnapshotStandards>>,
    { ok: true }
  > | null = null;
  if (isSubmit || isDesktop) {
    const explicitPerformedAt = Boolean(command.performedAt?.trim());
    const judged = await judgeSnapshotStandards({
      standardIds: snapshotStandardIds(nextStandardsSnapshot),
      organizationId,
      unitScope:
        isDesktop && command.unitScope
          ? buildUnitScopeCondition(referenceStandard.unitId, command.unitScope)
          : undefined,
      // Only an EXPLICIT performed date moves a desktop judgement off the
      // sync day.
      performedAt:
        actor.kind === "desktop_session"
          ? explicitPerformedAt
            ? performedAt
            : null
          : (performedAt ?? now),
      now,
      backdateReason,
      mode: jobExecutionStandardsMode(actor, explicitPerformedAt),
      // A submission must justify a standard that is valid only because the
      // work is back-dated; a draft save is advisory.
      requireBackdateReason: isSubmit,
    });
    if (!judged.ok) {
      return {
        status: "standards_refused",
        refusal: judged,
        error: standardsRefusalDomainError(judged),
      };
    }
    standardsJudgement = judged;
  }

  // 5. The asset snapshot. Built from the asset when the job has none yet; it
  //    is persisted by the command's own write, so a refusal leaves no trace.
  const assetResult = await resolveAssetSnapshot({
    organizationId,
    assetId: existing.assetId,
    assetSnapshot: existing.assetSnapshot,
    methodSnapshot: existing.methodSnapshot,
  });
  if (!assetResult.ok) {
    return {
      status: "asset_unavailable",
      error:
        assetResult.kind === "asset_not_found"
          ? invalid("asset_not_found", assetResult.error)
          : invalid("asset_specification_missing", assetResult.error),
    };
  }
  const nextAssetSnapshot: AssetSnapshot = assetResult.snapshot;

  // 6. Environment, calibration location and phases.
  let environmentalSnapshot: EnvironmentalSnapshot | null | undefined;
  if (command.frozen?.environmental) {
    environmentalSnapshot = command.frozen.environmental.value;
  } else {
    environmentalSnapshot = await buildEnvironmentalSnapshot(
      command.environment,
      existing,
      organizationId,
      actor.userId,
    );
  }
  const environmentalTouched = environmentalSnapshot !== undefined;
  const nextEnvironmentalSnapshot =
    environmentalSnapshot === undefined
      ? existing.environmentalSnapshot
      : environmentalSnapshot;

  const locationTouched =
    command.frozen?.calibrationLocation !== undefined ||
    command.calibrationLocation !== undefined;
  const nextCalibrationLocationSnapshot = command.frozen?.calibrationLocation
    ? command.frozen.calibrationLocation.value
    : (buildCalibrationLocationSnapshot(
        command.calibrationLocation,
        existing.calibrationLocationSnapshot,
        actor.userId,
      ) ?? null);
  const phasesTouched =
    command.frozen?.calibrationPhases !== undefined ||
    command.calibrationPhases !== undefined;
  const nextCalibrationPhaseSnapshot = command.frozen?.calibrationPhases
    ? command.frozen.calibrationPhases.value
    : (buildCalibrationPhaseSnapshot(
        command.calibrationPhases,
        existing.calibrationPhaseSnapshot,
        actor.userId,
      ) ?? null);

  // Every submit carries its calibration location and phase justifications,
  // the desktop's too (its frozen snapshots are what it recorded offline). The
  // one exception is an event a desktop build wrote before it enforced this
  // offline (`legacyUnvalidatedRecord`): applied as before, not dead-lettered.
  const recordCheckExempt = isDesktop && command.legacyUnvalidatedRecord;
  if (isSubmit && !recordCheckExempt) {
    const incomplete = validateCalibrationRecordForSubmit({
      location: nextCalibrationLocationSnapshot,
      phases: nextCalibrationPhaseSnapshot,
    });
    if (incomplete) {
      return {
        status: "record_incomplete",
        error: invalid("calibration_record_incomplete", incomplete),
      };
    }
  }

  const normalizedData = normalizeMethodDataForStorage(
    command.data,
    methodInputFieldsFromSnapshot(existing.methodSnapshot),
    nextAssetSnapshot.baseMeasurementUnit ?? null,
  );
  const nextData = stripAssetSpecData(
    normalizedData.data,
    existing.methodSnapshot,
  );

  // 7. The official execution. An engine release recompiles the published
  //    method but never rewrites the copies frozen into open jobs; adopt the
  //    recompiled method here when it is provably the same definition, or the
  //    job could never be saved or submitted again.
  const reconciledMethod = await reconcileMethodSnapshotEngine({
    methodSnapshot: existing.methodSnapshot,
    organizationId,
    engine: createMethodExecutionEngine(),
  });
  const nextMethodSnapshot = reconciledMethod.methodSnapshot;
  const officialExecution = executeOfficialCompiledSnapshot({
    methodSnapshot: nextMethodSnapshot,
    data: normalizedData.data ?? {},
    assetSnapshot: nextAssetSnapshot,
    standardsSnapshot: nextStandardsSnapshot,
    environmentalSnapshot: nextEnvironmentalSnapshot,
    calibrationPhaseSnapshot: nextCalibrationPhaseSnapshot,
    requireSuccess: isSubmit,
  });
  if (!officialExecution.ok) {
    return {
      status: "official_execution_failed",
      failure: {
        kind: officialExecution.kind,
        message: officialExecution.message,
        diagnostics: officialExecution.diagnostics,
      },
      error: unprocessable(
        "official_execution_failed",
        officialExecution.message,
      ),
    };
  }
  const nextResults = officialExecution.results;

  // 8. A submit only: competence, then the accredited-scope (CMC) guard.
  let scopeCompliance: Awaited<
    ReturnType<typeof classifyJobScopeCompliance>
  >["compliance"] = null;
  if (isSubmit) {
    const competent = await technicianHasCompetence({
      organizationId,
      technicianId: existing.technicianId,
      assetTypeId: nextAssetSnapshot.assetTypeId,
      performedAt: performedAt ?? now,
    });
    if (!competent) {
      return {
        status: "competence_missing",
        error: unprocessable(
          "technician_competence_missing",
          "Técnico não possui competência ativa para este tipo de instrumento",
        ),
      };
    }

    // ISO/IEC 17025 §7.6/§7.8.3, ILAC P14 (#427 Phase 0). Classified here so
    // the technician and the signer see the warning during review; approval
    // re-classifies at the emission date and is authoritative. Warn-only:
    // never blocks the submit. `now`, not performedAt: it predicts the seal
    // decision approval will make at the emission date.
    const classified = await classifyJobScopeCompliance({
      organizationId,
      unitId: existing.unitId,
      methodSnapshot: existing.methodSnapshot,
      assetSnapshot: nextAssetSnapshot,
      data: nextData ?? null,
      results: nextResults,
      atDate: now,
    });
    scopeCompliance = classified.compliance;
  }

  // 9. The compare-and-set write and its audit row, in one transaction.
  const nextDeviations =
    command.methodDeviations === undefined
      ? undefined
      : command.methodDeviations?.trim() || null;
  const backdatedStandardNames =
    standardsJudgement?.validOnlyBecauseBackdated.map(
      (standard) => standard.name,
    ) ?? [];
  const backdated =
    performed.backdateDays > 7 || (standardsJudgement?.reasonRequired ?? false);

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(calibrationJob)
      .set({
        data: nextData,
        results: nextResults,
        ...(reconciledMethod.adopted
          ? { methodSnapshot: nextMethodSnapshot }
          : {}),
        ...(isSubmit
          ? {
              scopeComplianceStatus: scopeCompliance?.status ?? null,
              scopeComplianceFindings: scopeCompliance?.findings ?? null,
              // A re-submission restarts the release flow: any override
              // recorded by a previous approval attempt no longer applies.
              scopeOverrideJustification: null,
            }
          : {}),
        assetSnapshot: nextAssetSnapshot,
        standardsSnapshot: nextStandardsSnapshot,
        environmentalSnapshot: nextEnvironmentalSnapshot,
        calibrationLocationSnapshot: nextCalibrationLocationSnapshot,
        calibrationPhaseSnapshot: nextCalibrationPhaseSnapshot,
        status: nextStatus,
        // A draft save without a usable date leaves the stored one alone.
        ...(performedAt ? { performedAt } : {}),
        // Absent = untouched: the worksheet auto-saves and a partial payload
        // must not wipe a deviation already recorded.
        ...(nextDeviations === undefined
          ? {}
          : { methodDeviations: nextDeviations }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(calibrationJob.id, existing.id),
          eq(calibrationJob.organizationId, organizationId),
          // Compare-and-set on the status this command validated: a
          // concurrent transition (approve, reject, cancel...) makes this
          // match zero rows instead of silently overwriting it.
          eq(calibrationJob.status, existing.status),
        ),
      )
      .returning();
    if (!row) return null;

    await tx.insert(jobAuditLog).values({
      organizationId,
      jobId: existing.id,
      action: command.command,
      changes: {
        ...jobActorAuditFields(actor),
        // Evidence that the frozen compiled method was re-pointed at the
        // method's current compilation (same definition, new engine).
        methodSnapshotEngine: reconciledMethod.adopted
          ? {
              old: {
                engineVersion: existing.methodSnapshot.engineVersion,
                methodFingerprint: existing.methodSnapshot.methodFingerprint,
              },
              new: {
                engineVersion: nextMethodSnapshot.engineVersion,
                methodFingerprint: nextMethodSnapshot.methodFingerprint,
              },
            }
          : undefined,
        status:
          isSubmit || existing.status !== nextStatus
            ? { old: existing.status, new: nextStatus }
            : undefined,
        data: { old: existing.data, new: nextData },
        results: { old: existing.results, new: nextResults },
        // What the client claimed its results were; they were not used.
        ...(command.clientResults
          ? actor.kind === "desktop_session"
            ? { desktopSubmittedResults: command.clientResults }
            : { clientSubmittedResults: command.clientResults }
          : {}),
        // §7.8.2.1(n) is printed on the certificate, so a change to it is
        // evidence an assessor may ask about. Logged only when it moved.
        methodDeviations:
          nextDeviations !== undefined &&
          nextDeviations !== existing.methodDeviations
            ? { old: existing.methodDeviations, new: nextDeviations }
            : undefined,
        officialExecution: {
          methodFingerprint: officialExecution.execution.methodFingerprint,
          inputFingerprint: officialExecution.execution.inputFingerprint,
          calculationFingerprint:
            officialExecution.execution.calculationFingerprint,
          resultFingerprint: officialExecution.execution.resultFingerprint,
        },
        standardsSnapshot: standardsTouched
          ? { old: existing.standardsSnapshot, new: nextStandardsSnapshot }
          : undefined,
        environmentalSnapshot: environmentalTouched
          ? {
              old: existing.environmentalSnapshot,
              new: nextEnvironmentalSnapshot,
            }
          : undefined,
        calibrationLocationSnapshot: locationTouched
          ? {
              old: existing.calibrationLocationSnapshot,
              new: nextCalibrationLocationSnapshot,
            }
          : undefined,
        calibrationPhaseSnapshot: phasesTouched
          ? {
              old: existing.calibrationPhaseSnapshot,
              new: nextCalibrationPhaseSnapshot,
            }
          : undefined,
        // Whether the calibration location and phase reasons were validated
        // when the job was submitted. "legacy_exempt" is a desktop submit from
        // a build that predates the rule: an auditor lists jobs whose location
        // was never validated by filtering on it.
        calibrationRecordCheck: isSubmit
          ? recordCheckExempt
            ? "legacy_exempt"
            : "enforced"
          : undefined,
        unitConversions:
          normalizedData.conversions.length > 0
            ? normalizedData.conversions
            : undefined,
        assetSnapshot: assetResult.built
          ? { old: null, new: nextAssetSnapshot }
          : undefined,
        // Every standard of the final snapshot was judged at the day the work
        // is recorded as performed, not at the day it is submitted.
        standardsJudgedAt:
          standardsJudgement && standardsJudgement.standardIds.length > 0
            ? {
                performedAt: (performedAt ?? now).toISOString(),
                standardIds: standardsJudgement.standardIds,
                validOnlyBecauseBackdated: backdatedStandardNames,
              }
            : undefined,
      },
      performedBy: actor.userId,
      ipAddress: actor.ipAddress ?? null,
      reason: isSubmit
        ? [
            nextEnvironmentalSnapshot && !nextEnvironmentalSnapshot.withinLimits
              ? "Submetido com condições ambientais fora dos limites"
              : null,
            scopeCompliance?.status === "OUT_OF_SCOPE"
              ? "Submetido com ponto fora do escopo acreditado (CMC)"
              : scopeCompliance?.status === "U_BELOW_CMC"
                ? "Submetido com incerteza menor que a CMC acreditada"
                : null,
            backdated
              ? `${SUBMIT_BACKDATE_NOTE} (${performed.backdateDays} dias): ${backdateReason}`
              : null,
            standardsJudgement?.reasonRequired
              ? `Padroes julgados na data de execucao (${(performedAt ?? now).toISOString()}): ${backdatedStandardNames.join(", ")} venceu apos essa data`
              : null,
          ]
            .filter(Boolean)
            .join(" | ") || undefined
        : undefined,
    });
    return row;
  });
  if (!updated) return { status: "concurrent_update" };

  // Reverse traceability (#426 Phase 1): mirror the frozen snapshot into the
  // indexed job_standard projection.
  await syncJobStandardLinks(
    existing.id,
    nextStandardsSnapshot,
    updated.performedAt ?? existing.performedAt,
    organizationId,
  );

  // On-site visits roll forward to IN_PROGRESS once any of their jobs starts.
  if (existing.status === "DRAFT" && updated.visitId) {
    try {
      await syncVisitStatusFromJobs(updated.visitId);
    } catch (error) {
      console.error("[Jobs] Failed to sync visit status:", error);
    }
  }

  return { status: "ok", job: updated, previousStatus: existing.status };
}
