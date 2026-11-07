import {
  buildLocalStandardsSnapshot,
  getLocalJobDetail,
  getLocalMethodDetail,
  localStandardsPerformedAt,
  resolveLocalDraftStandards,
  saveLocalJobExecution,
  type LocalDatabase,
} from "@calibra-facil/local-db";
import {
  buildCalibrationLocationSnapshot,
  buildCalibrationPhaseSnapshot,
  isCalibrationLocationSnapshot,
  isCalibrationPhaseSnapshot,
} from "@calibra-facil/method-definition";
import {
  ExecuteJobSchema,
  resolveExecutionPerformedAt,
  SubmitForReviewSchema,
  validateCalibrationRecordForSubmit,
} from "@calibra-facil/schemas";
import { toRecord } from "@calibra-facil/shared/record";
import type { LocalServerConfig } from "./bootstrap";
import { executeLocalCompiledMethod } from "./execution";
import { getLocalRequestContext } from "./request-context";

/**
 * The desktop's execute (draft save) and submit commands for a job. The same
 * request schemas as the cloud routes decide what is accepted, and the same
 * execution core (`@calibra-facil/method-definition`) builds the frozen
 * records and runs the official execution; what is left here is the local
 * store: which rows to read and what to save.
 */

type JobCommandResult = {
  status: 200 | 400 | 404 | 422;
  body: Record<string, unknown>;
};

/**
 * The cloud's submit body, plus the deviations note: the cloud ignores it on a
 * submit (the worksheet saved it with the draft), the local store applies it
 * with the submit so it cannot be lost offline.
 */
const submitBodySchema = SubmitForReviewSchema.extend({
  methodDeviations: ExecuteJobSchema.shape.methodDeviations,
});

type CommandContext = {
  config: LocalServerConfig;
  database: LocalDatabase;
};

export function executeLocalJob(
  context: CommandContext,
  routeId: string,
  body: unknown,
): JobCommandResult {
  const parsed = ExecuteJobSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error.issues);
  const input = parsed.data;
  const { config, database } = context;

  const current = getLocalJobDetail(database, routeId);
  if (!current) return jobNotFound();

  const actorUserId = getLocalRequestContext(config, database).userId;
  const recordedBy = actorUserId ?? "local";
  const calibrationLocationSnapshot = buildCalibrationLocationSnapshot(
    input.calibrationLocation,
    storedLocation(current.calibrationLocationSnapshot),
    recordedBy,
  );
  const calibrationPhaseSnapshot = buildCalibrationPhaseSnapshot(
    input.calibrationPhases,
    storedPhases(current.calibrationPhaseSnapshot),
    recordedBy,
  );
  try {
    // The cloud's draft rule: a standard of the saved snapshot that went
    // stale is kept (and reported in `warnings`); one the save adds is judged.
    const { snapshot: standardsSnapshot, warnings } =
      resolveLocalDraftStandards(database, {
        selectedStandardIds: input.selectedStandardIds,
        data: input.data,
        // Judged on the day the work is recorded as performed (a draft keeps
        // the date already saved).
        performedAt: localStandardsPerformedAt(
          input.performedAt,
          current.performedAt,
        ),
        savedStandardsSnapshot: current.standardsSnapshot,
      });
    const results = executeFrozenMethod(database, current, {
      data: input.data,
      standardsSnapshot,
      fallbackResults: input.results,
      environment: input.environment,
      calibrationPhaseSnapshot,
      requireSuccess: false,
    });
    const job = saveLocalJobExecution(database, {
      routeId,
      data: input.data,
      results,
      selectedStandardIds: input.selectedStandardIds,
      environment: input.environment,
      calibrationLocationSnapshot,
      calibrationPhaseSnapshot,
      methodDeviations: input.methodDeviations,
      performedAt: input.performedAt,
      actorUserId,
      deviceId: config.deviceId,
    });

    return {
      status: 200,
      body: { message: "Dados salvos com sucesso", data: job, warnings },
    };
  } catch (error) {
    return commandFailure(error);
  }
}

export function submitLocalJob(
  context: CommandContext,
  routeId: string,
  body: unknown,
): JobCommandResult {
  const parsed = submitBodySchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error.issues);
  const input = parsed.data;
  const { config, database } = context;

  const current = getLocalJobDetail(database, routeId);
  if (!current) return jobNotFound();

  const actorUserId = getLocalRequestContext(config, database).userId;
  const recordedBy = actorUserId ?? "local";
  const calibrationLocationSnapshot = buildCalibrationLocationSnapshot(
    input.calibrationLocation,
    storedLocation(current.calibrationLocationSnapshot),
    recordedBy,
  );
  const calibrationPhaseSnapshot = buildCalibrationPhaseSnapshot(
    input.calibrationPhases,
    storedPhases(current.calibrationPhaseSnapshot),
    recordedBy,
  );
  // The cloud's rule, the same function the local database applies again.
  const calibrationRecordError = validateCalibrationRecordForSubmit({
    location: calibrationLocationSnapshot,
    phases: calibrationPhaseSnapshot,
  });
  if (calibrationRecordError) {
    return { status: 400, body: { error: calibrationRecordError } };
  }
  // The cloud's rules for the performed date, answered the same way (400):
  // not in the future, and a reason once it is more than 7 days back.
  const performedAtError = resolveExecutionPerformedAt({
    performedAt: input.performedAt,
    backdateReason: input.backdateReason,
  });
  if (!performedAtError.ok) {
    return { status: 400, body: { error: performedAtError.message } };
  }
  try {
    const standardsSnapshot = buildLocalStandardsSnapshot(
      database,
      input.selectedStandardIds,
      input.data,
      // Judged on the day the work is recorded as performed (the cloud rule).
      localStandardsPerformedAt(input.performedAt, null),
    );
    const results = executeFrozenMethod(database, current, {
      data: input.data,
      standardsSnapshot,
      fallbackResults: input.results,
      environment: input.environment,
      calibrationPhaseSnapshot,
      requireSuccess: true,
    });
    const job = saveLocalJobExecution(database, {
      routeId,
      data: input.data,
      results,
      selectedStandardIds: input.selectedStandardIds,
      environment: input.environment,
      calibrationLocationSnapshot,
      calibrationPhaseSnapshot,
      methodDeviations: input.methodDeviations,
      performedAt: input.performedAt,
      backdateReason: input.backdateReason,
      requireResults: true,
      actorUserId,
      deviceId: config.deviceId,
    });

    return {
      status: 200,
      body: { message: "Job submetido para revisao", data: job },
    };
  } catch (error) {
    return commandFailure(error);
  }
}

type LocalJob = NonNullable<ReturnType<typeof getLocalJobDetail>>;

/** The official execution of the job's frozen method over the data of a save. */
function executeFrozenMethod(
  database: LocalDatabase,
  job: LocalJob,
  params: {
    data: Record<string, unknown>;
    /** What this save froze; `undefined` keeps the job's own. */
    standardsSnapshot: unknown;
    fallbackResults: Record<string, unknown> | undefined;
    environment:
      | {
          temperature: number | null;
          humidity: number | null;
          pressure: number | null;
        }
      | undefined;
    calibrationPhaseSnapshot: ReturnType<typeof buildCalibrationPhaseSnapshot>;
    requireSuccess: boolean;
  },
) {
  const methodSnapshot = toRecord(job.methodSnapshot);
  return executeLocalCompiledMethod({
    methodSnapshot,
    currentCompiledMethod: currentPublishedCompiledMethod(
      database,
      methodSnapshot,
    ),
    assetSnapshot: toRecord(job.assetSnapshot),
    standardsSnapshot:
      params.standardsSnapshot === undefined
        ? job.standardsSnapshot
        : params.standardsSnapshot,
    data: params.data,
    fallbackResults: recordOrNull(params.fallbackResults),
    environmentalSnapshot: params.environment,
    calibrationPhaseSnapshot: params.calibrationPhaseSnapshot,
    requireSuccess: params.requireSuccess,
  });
}

/**
 * The compiled method currently published locally for a job's frozen snapshot,
 * used only to re-point that snapshot when a desktop release moved the engine
 * under it (see `executeLocalCompiledMethod`). Resolved by the snapshot's own
 * method id and version, so a newer published version is never substituted.
 */
function currentPublishedCompiledMethod(
  database: LocalDatabase,
  methodSnapshot: Record<string, unknown>,
): unknown {
  const methodId = methodSnapshot.methodId;
  const methodVersion = methodSnapshot.methodVersion;
  if (typeof methodId !== "number") return null;
  const method = getLocalMethodDetail(database, String(methodId));
  if (!method) return null;
  if (typeof methodVersion === "number" && method.version !== methodVersion) {
    return null;
  }
  return method.compiledMethod;
}

function storedLocation(value: unknown) {
  return isCalibrationLocationSnapshot(value) ? value : null;
}

function storedPhases(value: unknown) {
  return isCalibrationPhaseSnapshot(value) ? value : null;
}

function recordOrNull(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  return value && Object.keys(value).length > 0 ? value : null;
}

function jobNotFound(): JobCommandResult {
  return { status: 404, body: { error: "Job nao encontrado" } };
}

/** The cloud validates the same body with the same schema and answers 400. */
function invalidBody(issues: readonly unknown[]): JobCommandResult {
  return {
    status: 400,
    body: { error: "Dados invalidos para execucao do job", issues },
  };
}

function commandFailure(error: unknown): JobCommandResult {
  return {
    status: 422,
    body: {
      error: error instanceof Error ? error.message : "Erro local",
      diagnostics: getDiagnostics(error),
    },
  };
}

function getDiagnostics(error: unknown) {
  if (error && typeof error === "object" && "diagnostics" in error) {
    return Reflect.get(error, "diagnostics");
  }

  return undefined;
}
