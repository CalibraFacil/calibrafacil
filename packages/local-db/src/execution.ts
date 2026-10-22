import { randomUUID } from "node:crypto";
import {
  judgeExecutionStandards,
  resolveExecutionPerformedAt,
  type JudgedStandardFacts,
  type StandardsJudgement,
  type StandardsJudgementMode,
} from "@calibra-facil/schemas";
import {
  canTransition,
  requireTargetOf,
} from "@calibra-facil/schemas/job-transitions";
import type { LocalDatabase } from "./database";
import { getLocalEffectiveEnvironmentalLimits } from "./environmental-limits";
import { stableLocalNumericId } from "./ids";
import type { LocalJobStatus } from "./jobs";

type JsonRecord = Record<string, unknown>;

export type LocalJobCommandInput = {
  actorUserId?: string | null;
  deviceId?: string | null;
};

export type CreateLocalJobDraftInput = LocalJobCommandInput & {
  organizationId?: string | null;
  unitId?: number | null;
  assetId: number;
  serviceId: number;
  technicianId?: string | null;
  dueDate?: string | null;
};

export type SaveLocalExecutionInput = LocalJobCommandInput & {
  routeId: string;
  data: JsonRecord;
  results?: JsonRecord | null;
  selectedStandardIds?: number[];
  environment?: {
    temperature: number | null;
    humidity: number | null;
    pressure: number | null;
  };
  calibrationLocationSnapshot?: JsonRecord | null;
  calibrationPhaseSnapshot?: JsonRecord | null;
  /**
   * ISO/IEC 17025 §7.8.2.1(n). Absent leaves the stored value untouched (the
   * worksheet auto-saves and a partial payload must not wipe it); explicit
   * null clears it. Mirrors the cloud POST /jobs/:id/execute contract.
   */
  methodDeviations?: string | null;
  /**
   * When the calibration was actually performed (ISO). Same rules as the cloud
   * `POST /jobs/:id/submit`: on a submit it defaults to now, may not be in the
   * future, and needs `backdateReason` once it is more than 7 days back. On a
   * draft save a valid value is just remembered (an invalid one is ignored).
   */
  performedAt?: string;
  backdateReason?: string;
  requireResults?: boolean;
};

export function createLocalJobDraft(
  database: LocalDatabase,
  input: CreateLocalJobDraftInput,
) {
  const now = new Date().toISOString();
  const asset = getAssetByRemoteId(database, input.assetId);
  if (!asset) {
    throw new Error("Ativo nao encontrado");
  }

  const service = getServiceByRemoteId(database, input.serviceId);
  if (!service) {
    throw new Error("Servico nao encontrado");
  }

  if (service.status !== "ACTIVE") {
    throw new Error("Servico esta inativo");
  }

  const method = service.method_id
    ? getPublishedMethod(database, service.method_id)
    : null;
  if (!method) {
    throw new Error("Servico nao possui metodo vinculado");
  }

  const methodPayload = parseJsonRecord(method.normalized_method_json);
  const methodSnapshot = {
    methodId: method.remote_id,
    methodName: method.name,
    methodVersion: method.version,
    compiledMethod: parseJson(method.compiled_method_json),
    methodFingerprint: method.method_fingerprint,
    engineVersion: method.engine_version,
    engineOptionsFingerprint: method.engine_options_fingerprint,
    normalizedMethodJson:
      getCompiledNormalizedMethodJson(method.compiled_method_json) ??
      method.normalized_method_json,
    publicationEvidence: parseJson(method.publication_evidence_json),
    dataFields: getArray(methodPayload.dataFields),
    variableBindings: getArray(methodPayload.variableBindings),
    formulas: getArray(methodPayload.formulas),
    measurementModels: getArray(methodPayload.measurementModels),
    validations: getArray(methodPayload.validations),
    uncertaintyParams: getArray(methodPayload.uncertaintyParams),
    certificateContent: methodPayload.certificateContent ?? null,
    // Freeze the ISO 17025 accredited-scope flag into the offline snapshot,
    // matching the cloud path (see apps/api/src/lib/jobs.ts).
    accreditedScope: methodPayload.accreditedScope === true,
  };
  const assetSnapshot = {
    assetId: asset.remote_id ?? stableLocalNumericId(asset.id),
    assetTypeId:
      asset.asset_type_remote_id ?? stableLocalNumericId(asset.asset_type_id),
    assetTypeName: asset.asset_type_name ?? "Tipo local",
    assetTypeSlug: asset.asset_type_slug ?? "local",
    baseMeasurementUnit: asset.base_measurement_unit,
    name: asset.name,
    tag: asset.tag,
    serialNumber: asset.serial_number,
    manufacturer: asset.manufacturer,
    model: asset.model,
    specifications: parseJsonRecord(asset.specifications_json),
    capturedAt: now,
  };
  const localId = `job:local:${randomUUID()}`;
  const jobId = nextLocalJobId(database);
  const organizationId = input.organizationId ?? asset.organization_id;
  const unitId = input.unitId ?? asset.unit_id;

  database.transaction(() => {
    database
      .prepare(
        `
INSERT INTO calibration_jobs (
  id,
  remote_id,
  job_id,
  certificate_name,
  organization_id,
  unit_id,
  customer_id,
  asset_id,
  service_id,
  technician_id,
  method_snapshot_json,
  asset_snapshot_json,
  standards_snapshot_json,
  environmental_snapshot_json,
  calibration_location_snapshot_json,
  calibration_phase_snapshot_json,
  data_json,
  results_json,
  status,
  due_date,
  version,
  created_at,
  updated_at,
  sync_state
) VALUES (
  @id,
  NULL,
  @jobId,
  NULL,
  @organizationId,
  @unitId,
  @customerId,
  @assetId,
  @serviceId,
  @technicianId,
  @methodSnapshotJson,
  @assetSnapshotJson,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  @status,
  @dueDate,
  0,
  @createdAt,
  @updatedAt,
  'local'
)
`,
      )
      .run({
        id: localId,
        jobId,
        organizationId,
        unitId,
        customerId: asset.customer_id,
        assetId: asset.id,
        serviceId: service.id,
        technicianId: input.technicianId ?? null,
        methodSnapshotJson: JSON.stringify(methodSnapshot),
        assetSnapshotJson: JSON.stringify(assetSnapshot),
        status: requireTargetOf(null, "create"),
        dueDate: input.dueDate ?? null,
        createdAt: now,
        updatedAt: now,
      });

    appendLocalAudit(database, {
      entityType: "calibration_job",
      entityId: localId,
      action: "create",
      actorUserId: input.actorUserId,
      details: { jobId, assetId: input.assetId, serviceId: input.serviceId },
      createdAt: now,
    });
    appendOutboxEvent(database, {
      entityType: "calibration_job",
      entityId: localId,
      operation: "create_local_job_draft",
      payload: {
        jobId,
        assetId: input.assetId,
        serviceId: input.serviceId,
        technicianId: input.technicianId ?? null,
        dueDate: input.dueDate ?? null,
        unitId,
      },
      actorUserId: input.actorUserId,
      deviceId: input.deviceId,
      occurredAt: now,
    });
  })();

  return getLocalJobDetail(database, String(stableLocalNumericId(localId)));
}

export function getLocalJobDetail(database: LocalDatabase, routeId: string) {
  const job = findLocalJob(database, routeId);
  if (!job) return null;

  return toJobDetail(job);
}

export function saveLocalJobExecution(
  database: LocalDatabase,
  input: SaveLocalExecutionInput,
) {
  const existing = findLocalJob(database, input.routeId);
  if (!existing) {
    throw new Error("Job nao encontrado");
  }

  // The same table the cloud uses: a submit goes to REVIEW, a plain save keeps
  // the job open (DRAFT becomes IN_PROGRESS).
  const command = input.requireResults ? "submit" : "execute";
  if (!canTransition(existing.status, command)) {
    throw new Error(
      `Nao e possivel executar um job com status ${existing.status}`,
    );
  }

  const now = new Date().toISOString();
  const nextStatus: LocalJobStatus = requireTargetOf(existing.status, command);
  const executionTime = resolveLocalExecutionTime(
    nextStatus === "REVIEW",
    input,
  );
  const standardsSnapshot = buildLocalStandardsSnapshot(
    database,
    input.selectedStandardIds,
    input.data,
    // The date the work is recorded at; a draft keeps the one already saved.
    localStandardsPerformedAt(
      input.performedAt,
      nextStatus === "REVIEW" ? null : existing.performed_at,
    ),
  );
  // A submit re-judges EVERY standard of the final snapshot (also one saved
  // earlier and not named again) at the final performed day, like the cloud.
  const standardsJudgement =
    nextStatus === "REVIEW"
      ? judgeSubmittedLocalStandards(database, {
          standardIds: standardsSnapshot
            ? standardsSnapshot.map((standard) => standard.id)
            : parseSnapshotStandardIds(existing.standards_snapshot_json),
          performedAt: executionTime.performedAt
            ? new Date(executionTime.performedAt)
            : new Date(),
          backdateReason: input.backdateReason?.trim() || null,
        })
      : noStandardsJudgement();
  const environmentalSnapshot = input.environment
    ? buildEnvironmentalSnapshot(database, existing, input.environment, {
        recordedAt: now,
        recordedBy: input.actorUserId ?? "local",
      })
    : parseJson(existing.environmental_snapshot_json);
  const calibrationLocationSnapshot =
    input.calibrationLocationSnapshot === undefined
      ? parseJson(existing.calibration_location_snapshot_json)
      : input.calibrationLocationSnapshot;
  const calibrationPhaseSnapshot =
    input.calibrationPhaseSnapshot === undefined
      ? parseJson(existing.calibration_phase_snapshot_json)
      : input.calibrationPhaseSnapshot;

  database.transaction(() => {
    database
      .prepare(
        `
UPDATE calibration_jobs
SET
  data_json = @dataJson,
  results_json = @resultsJson,
  standards_snapshot_json = @standardsSnapshotJson,
  environmental_snapshot_json = @environmentalSnapshotJson,
  calibration_location_snapshot_json = @calibrationLocationSnapshotJson,
  calibration_phase_snapshot_json = @calibrationPhaseSnapshotJson,
  method_deviations = @methodDeviations,
  status = @status,
  submitted_at = @submittedAt,
  performed_at = COALESCE(@performedAt, performed_at),
  updated_at = @updatedAt,
  sync_state = 'local'
WHERE id = @id
`,
      )
      .run({
        id: existing.id,
        performedAt: executionTime.performedAt,
        dataJson: JSON.stringify(input.data),
        resultsJson: JSON.stringify(input.results ?? null),
        standardsSnapshotJson:
          standardsSnapshot === undefined
            ? existing.standards_snapshot_json
            : JSON.stringify(standardsSnapshot),
        environmentalSnapshotJson: JSON.stringify(environmentalSnapshot),
        calibrationLocationSnapshotJson: JSON.stringify(
          calibrationLocationSnapshot ?? null,
        ),
        calibrationPhaseSnapshotJson: JSON.stringify(
          calibrationPhaseSnapshot ?? null,
        ),
        methodDeviations:
          input.methodDeviations === undefined
            ? existing.method_deviations
            : input.methodDeviations?.trim() || null,
        status: nextStatus,
        submittedAt: nextStatus === "REVIEW" ? now : existing.submitted_at,
        updatedAt: now,
      });

    appendLocalAudit(database, {
      entityType: "calibration_job",
      entityId: existing.id,
      action: nextStatus === "REVIEW" ? "submit" : "execute",
      actorUserId: input.actorUserId,
      details: {
        status: { old: existing.status, new: nextStatus },
        resultKeys: Object.keys(input.results ?? {}),
        ...(executionTime.performedAt
          ? { performedAt: executionTime.performedAt }
          : {}),
        ...(executionTime.backdateReason
          ? { backdateReason: executionTime.backdateReason }
          : {}),
      },
      createdAt: now,
    });
    const payload: Record<string, unknown> = {
      data: input.data,
      results: input.results ?? null,
      standardsSnapshot,
      environmentalSnapshot,
      calibrationLocationSnapshot,
      calibrationPhaseSnapshot,
      methodDeviations:
        input.methodDeviations === undefined
          ? existing.method_deviations
          : input.methodDeviations?.trim() || null,
      status: nextStatus,
    };
    if (existing.remote_id !== null) {
      payload.remoteId = existing.remote_id;
    }
    if (executionTime.performedAt) {
      payload.performedAt = executionTime.performedAt;
    }
    // The written reason travels with the event when the submission needed it:
    // past 7 days, or because a standard is valid only on the performed day.
    const submittedReason =
      executionTime.backdateReason ??
      (standardsJudgement.validOnlyBecauseBackdated.length > 0
        ? input.backdateReason?.trim() || null
        : null);
    if (submittedReason) {
      payload.backdateReason = submittedReason;
    }

    appendOutboxEvent(database, {
      entityType: "calibration_job",
      entityId: existing.id,
      operation:
        nextStatus === "REVIEW"
          ? "submit_local_execution"
          : "save_local_execution",
      payload,
      actorUserId: input.actorUserId,
      deviceId: input.deviceId,
      occurredAt: now,
    });
  })();

  return getLocalJobDetail(database, input.routeId);
}

function resolveLocalExecutionTime(
  isSubmit: boolean,
  input: Pick<SaveLocalExecutionInput, "performedAt" | "backdateReason">,
): { performedAt: string | null; backdateReason: string | null } {
  if (isSubmit) {
    const resolved = resolveExecutionPerformedAt({
      performedAt: input.performedAt,
      backdateReason: input.backdateReason,
    });
    if (!resolved.ok) throw new Error(resolved.message);

    return {
      performedAt: resolved.performedAt.toISOString(),
      backdateReason: resolved.backdateReason,
    };
  }

  // A draft save only remembers the date (the cloud's /execute does the same);
  // the strict checks run on submit.
  const parsed = input.performedAt ? new Date(input.performedAt) : null;
  return {
    performedAt:
      parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
    backdateReason: null,
  };
}

function findLocalJob(database: LocalDatabase, routeId: string) {
  const remoteId = Number(routeId);
  if (Number.isFinite(remoteId)) {
    const remoteMatch = database
      .prepare<{ remoteId: number }, LocalJobRow>(
        `
SELECT j.*,
  c.remote_id AS customer_remote_id,
  c.name AS customer_name,
  c.tax_id AS customer_tax_id,
  a.remote_id AS asset_remote_id,
  a.name AS asset_name,
  a.tag AS asset_tag,
  a.serial_number AS asset_serial_number,
  a.manufacturer AS asset_manufacturer,
  a.model AS asset_model,
  at.remote_id AS asset_type_remote_id,
  at.name AS asset_type_name,
  s.remote_id AS service_remote_id,
  s.name AS service_name
FROM calibration_jobs j
LEFT JOIN customers c ON c.id = j.customer_id
LEFT JOIN assets a ON a.id = j.asset_id
LEFT JOIN asset_types at ON at.id = a.asset_type_id
LEFT JOIN services s ON s.id = j.service_id
WHERE j.remote_id = @remoteId AND j.deleted_at IS NULL
`,
      )
      .get({ remoteId });
    if (remoteMatch) return remoteMatch;
  }

  const rows = database
    .prepare<[], LocalJobRow>(
      `
SELECT j.*,
  c.remote_id AS customer_remote_id,
  c.name AS customer_name,
  c.tax_id AS customer_tax_id,
  a.remote_id AS asset_remote_id,
  a.name AS asset_name,
  a.tag AS asset_tag,
  a.serial_number AS asset_serial_number,
  a.manufacturer AS asset_manufacturer,
  a.model AS asset_model,
  at.remote_id AS asset_type_remote_id,
  at.name AS asset_type_name,
  s.remote_id AS service_remote_id,
  s.name AS service_name
FROM calibration_jobs j
LEFT JOIN customers c ON c.id = j.customer_id
LEFT JOIN assets a ON a.id = j.asset_id
LEFT JOIN asset_types at ON at.id = a.asset_type_id
LEFT JOIN services s ON s.id = j.service_id
WHERE j.deleted_at IS NULL
`,
    )
    .all();

  return rows.find((row) => String(stableLocalNumericId(row.id)) === routeId);
}

function toJobDetail(job: LocalJobRow) {
  const assetSnapshot = parseJsonRecord(job.asset_snapshot_json);

  return {
    id: job.remote_id ?? stableLocalNumericId(job.id),
    jobId: job.job_id ?? job.id,
    status: job.status,
    customerId: job.customer_remote_id ?? stableLocalNumericId(job.customer_id),
    customerName: job.customer_name ?? "",
    customerTaxId: job.customer_tax_id,
    assetId: job.asset_remote_id ?? stableLocalNumericId(job.asset_id),
    assetName: job.asset_name ?? "",
    assetTag: job.asset_tag ?? "",
    assetSerialNumber: job.asset_serial_number ?? "",
    assetManufacturer: job.asset_manufacturer,
    assetModel: job.asset_model,
    unitId: job.unit_id,
    assetTypeId:
      job.asset_type_remote_id ??
      getNumber(assetSnapshot, "assetTypeId") ??
      stableLocalNumericId(job.asset_id),
    assetTypeName:
      job.asset_type_name ??
      (typeof assetSnapshot.assetTypeName === "string"
        ? assetSnapshot.assetTypeName
        : ""),
    serviceId: job.service_remote_id ?? stableLocalNumericId(job.service_id),
    serviceName: job.service_name ?? "",
    technicianId: job.technician_id,
    technicianName: null,
    methodSnapshot: parseJsonRecord(job.method_snapshot_json),
    data: parseJsonRecordOrNull(job.data_json),
    results: parseJsonRecordOrNull(job.results_json),
    assetSnapshot,
    standardsSnapshot: parseJson(job.standards_snapshot_json),
    environmentalSnapshot: parseJson(job.environmental_snapshot_json),
    calibrationLocationSnapshot: parseJson(
      job.calibration_location_snapshot_json,
    ),
    calibrationPhaseSnapshot: parseJson(job.calibration_phase_snapshot_json),
    // #427: frozen accredited-scope verdict, mirrored from the cloud row so
    // the desktop review warnings and the seal-suppression decision match
    // the cloud exactly (an override-downgraded certificate must never show
    // the seal here either).
    scopeComplianceStatus: job.scope_compliance_status,
    scopeComplianceFindings: parseJson(job.scope_compliance_findings_json),
    scopeOverrideJustification: job.scope_override_justification,
    methodDeviations: job.method_deviations,
    dueDate: job.due_date,
    performedAt: job.performed_at,
    submittedAt: job.submitted_at,
    approvedAt: job.approved_at,
    rejectedAt: job.rejected_at,
    certificateUrl: job.certificate_url,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    syncState: job.sync_state,
  };
}

function getAssetByRemoteId(database: LocalDatabase, remoteId: number) {
  const remoteRow = database
    .prepare<{ remoteId: number }, LocalAssetCommandRow>(
      `
SELECT a.*, at.remote_id AS asset_type_remote_id, at.name AS asset_type_name,
  NULL AS asset_type_slug
FROM assets a
LEFT JOIN asset_types at ON at.id = a.asset_type_id
WHERE a.remote_id = @remoteId AND a.deleted_at IS NULL
`,
    )
    .get({ remoteId });
  if (remoteRow) return remoteRow;

  const rows = database
    .prepare<[], LocalAssetCommandRow>(
      `
SELECT a.*, at.remote_id AS asset_type_remote_id, at.name AS asset_type_name,
  NULL AS asset_type_slug
FROM assets a
LEFT JOIN asset_types at ON at.id = a.asset_type_id
WHERE a.deleted_at IS NULL
`,
    )
    .all();

  return rows.find((row) => stableLocalNumericId(row.id) === remoteId);
}

function getServiceByRemoteId(database: LocalDatabase, remoteId: number) {
  return database
    .prepare<
      { remoteId: number },
      LocalServiceCommandRow
    >("SELECT * FROM services WHERE remote_id = @remoteId")
    .get({ remoteId });
}

function getPublishedMethod(database: LocalDatabase, localMethodId: string) {
  return database
    .prepare<
      { id: string },
      LocalPublishedMethodRow
    >("SELECT * FROM published_methods WHERE id = @id")
    .get({ id: localMethodId });
}

/**
 * The moment a calibration is recorded as performed, for judging whether its
 * reference standards were valid (REQ-CAL-004): the date entered with the
 * request, else the one already saved on the job, else now. An unreadable or
 * future date falls back the same way (the submit rules reject it separately).
 */
export function localStandardsPerformedAt(
  requested: string | null | undefined,
  saved: string | null | undefined,
  now: Date = new Date(),
): Date {
  for (const [candidate, allowFuture] of [
    [requested, false],
    [saved, true],
  ] as const) {
    if (!candidate) continue;
    const parsed = new Date(candidate);
    if (Number.isNaN(parsed.getTime())) continue;
    if (!allowFuture && parsed.getTime() > now.getTime()) continue;
    return parsed;
  }
  return now;
}

/** The ids of the standards a saved snapshot JSON refers to. */
function parseSnapshotStandardIds(snapshotJson: string | null): number[] {
  if (!snapshotJson) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(snapshotJson);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const ids: number[] = [];
  for (const entry of parsed) {
    if (!isJsonObject(entry)) continue;
    const id = getNumber(entry, "id");
    if (id !== null) ids.push(id);
  }
  return ids;
}

function noStandardsJudgement(): { validOnlyBecauseBackdated: string[] } {
  return { validOnlyBecauseBackdated: [] };
}

function loadLocalStandardRows(
  database: LocalDatabase,
  ids: readonly number[],
): LocalReferenceStandardRow[] {
  if (ids.length === 0) return [];
  return database
    .prepare<number[], LocalReferenceStandardRow>(
      `
SELECT *
FROM reference_standards
WHERE remote_id IN (${ids.map(() => "?").join(",")})
`,
    )
    .all(...ids);
}

/**
 * The cached standards as facts for the one judgement. The cache only holds
 * the laboratory's own standards, so a row is always in scope; the offline
 * table keeps no deletion instant, only the `deleted` sync state.
 */
function localStandardFacts(
  rows: readonly LocalReferenceStandardRow[],
): JudgedStandardFacts[] {
  const facts: JudgedStandardFacts[] = [];
  for (const row of rows) {
    if (row.remote_id === null) continue;
    facts.push({
      id: row.remote_id,
      name: row.name,
      status: row.status,
      deletedAt: row.sync_state === "deleted" ? "deleted" : null,
      nextCalibrationDate:
        getString(parseJsonRecord(row.snapshot_json), "nextCalibrationDate") ??
        row.next_calibration_date,
      inScope: true,
    });
  }
  return facts;
}

/**
 * The offline runtime of the one standards judgement (Q12, REQ-SJ-3): load the
 * cached standards and call `judgeExecutionStandards`, which the cloud, the
 * public API and the desktop sync apply share. Exported for the parity test;
 * the offline paths use it through `judgeSubmittedLocalStandards` (a submit)
 * and `buildLocalStandardsSnapshot` (a draft save).
 */
export function judgeLocalStandards(
  database: LocalDatabase,
  input: {
    standardIds: readonly number[];
    performedAt: Date | null;
    today?: Date;
    backdateReason?: string | null;
    mode?: StandardsJudgementMode;
    requireBackdateReason?: boolean;
  },
): StandardsJudgement {
  return judgeExecutionStandards(
    {
      standardIds: input.standardIds,
      performedAt: input.performedAt,
      today: input.today ?? new Date(),
      backdateReason: input.backdateReason,
      mode: input.mode ?? "desktop_explicit",
      requireBackdateReason: input.requireBackdateReason,
    },
    localStandardFacts(loadLocalStandardRows(database, input.standardIds)),
  );
}

/** The pt-BR error the offline paths throw for a refused judgement. */
function localStandardsRefusalError(
  refusal: Extract<StandardsJudgement, { ok: false }>,
): Error {
  const names = refusal.standardNames.join(", ");
  switch (refusal.code) {
    case "standard_not_found":
      return new Error(
        `Padrao ${refusal.standardIds.join(", ")} nao encontrado no cache local`,
      );
    case "standard_deleted":
      return new Error(`Padrao ${names} nao encontrado no cache local`);
    case "standard_inactive":
      return new Error(`Padrao ${names} nao esta ativo`);
    case "standard_expired":
      return new Error(`Padrao ${names} esta com certificado vencido`);
    case "standard_backdate_reason_required":
      return new Error(
        `O certificado de ${names} venceu apos a data de execucao; e necessario justificar o lancamento retroativo (motivo do registro retroativo)`,
      );
  }
}

/**
 * Submit-time judgement of the standards a job is recorded with (Q12), offline:
 * every standard of the FINAL snapshot, judged on the laboratory day of the
 * final performed date by the same function the cloud uses.
 */
function judgeSubmittedLocalStandards(
  database: LocalDatabase,
  input: {
    standardIds: readonly number[];
    performedAt: Date;
    backdateReason: string | null;
  },
): { validOnlyBecauseBackdated: string[] } {
  const judgement = judgeLocalStandards(database, input);
  if (!judgement.ok) throw localStandardsRefusalError(judgement);
  return {
    validOnlyBecauseBackdated: judgement.validOnlyBecauseBackdated.map(
      (standard) => standard.name,
    ),
  };
}

export function buildLocalStandardsSnapshot(
  database: LocalDatabase,
  selectedStandardIds: number[] | undefined,
  data: JsonRecord = {},
  performedAt: Date = new Date(),
) {
  const compositionStandardIds = collectCompositionStandardIds(data);
  if (
    selectedStandardIds === undefined &&
    compositionStandardIds.length === 0
  ) {
    return undefined;
  }

  const standardIds = Array.from(
    new Set([...(selectedStandardIds ?? []), ...compositionStandardIds]),
  );
  if (standardIds.length === 0) return [];

  const rows = loadLocalStandardRows(database, standardIds);
  const rowsByRemoteId = new Map(rows.map((row) => [row.remote_id, row]));
  const compositionStandardIdSet = new Set(compositionStandardIds);

  // A draft save judges with the same function as a submit, at the day the work
  // is recorded as performed; only the back-date reason waits for the submit.
  const judgement = judgeLocalStandards(database, {
    standardIds,
    performedAt,
    mode: "desktop_explicit",
    requireBackdateReason: false,
  });
  if (!judgement.ok) throw localStandardsRefusalError(judgement);

  return standardIds.map((standardId) => {
    const row = rowsByRemoteId.get(standardId);
    if (!row) {
      throw new Error(`Padrao ${standardId} nao encontrado no cache local`);
    }

    const snapshot = parseJsonRecord(row.snapshot_json);
    const nextCalibrationDate =
      getString(snapshot, "nextCalibrationDate") ?? row.next_calibration_date;

    const certifiedValues = parseSnapshotCertifiedValues(
      snapshot.certifiedValues,
    );
    if (compositionStandardIdSet.has(standardId) && !certifiedValues?.length) {
      throw new Error(
        `Padrao ${row.name} nao possui valores certificados completos no cache local`,
      );
    }

    return {
      id: standardId,
      name: getString(snapshot, "name") ?? row.name,
      kind: getString(snapshot, "kind") ?? undefined,
      type: getNullableString(snapshot, "type"),
      certificateNumber:
        getString(snapshot, "certificateNumber") ??
        row.certificate_number ??
        "",
      calibratedBy: getNullableString(snapshot, "calibratedBy"),
      calibrationDate: getString(snapshot, "calibrationDate") ?? "",
      nextCalibrationDate,
      uncertainty: getNullableNumber(snapshot, "uncertainty"),
      uncertaintyUnit: getNullableString(snapshot, "uncertaintyUnit"),
      coverageFactor: getNumber(snapshot, "coverageFactor") ?? 2,
      distribution:
        getString(snapshot, "distribution") === "rectangular"
          ? "rectangular"
          : "normal",
      drift: getNullableNumber(snapshot, "drift"),
      certifiedValues,
      metrologyData: isJsonObject(snapshot.metrologyData)
        ? snapshot.metrologyData
        : null,
      certificateDocument: isJsonObject(snapshot.certificateDocument)
        ? snapshot.certificateDocument
        : null,
    };
  });
}

function collectCompositionStandardIds(data: JsonRecord) {
  const ids = new Set<number>();

  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    if (!isJsonObject(value)) return;

    if (
      value.kind === "mass_standard_composition" &&
      Array.isArray(value.items)
    ) {
      for (const item of value.items) {
        if (!isJsonObject(item)) continue;
        const standardIds = Array.isArray(item.standardIds)
          ? item.standardIds
          : [];
        if (standardIds.length > 0) {
          for (const standardId of standardIds) {
            if (isPositiveInteger(standardId)) ids.add(standardId);
          }
        } else if (isPositiveInteger(item.standardId)) {
          ids.add(item.standardId);
        }
      }
      return;
    }

    for (const child of Object.values(value)) visit(child);
  };

  visit(data);
  return Array.from(ids);
}

function parseSnapshotCertifiedValues(value: unknown): JsonRecord[] | null {
  if (!Array.isArray(value)) return null;
  const values: JsonRecord[] = [];

  for (const item of value) {
    if (!isJsonObject(item)) continue;
    if (
      typeof item.nominal !== "string" ||
      typeof item.value !== "number" ||
      !Number.isFinite(item.value) ||
      typeof item.uncertainty !== "number" ||
      !Number.isFinite(item.uncertainty) ||
      typeof item.unit !== "string"
    ) {
      continue;
    }
    values.push({ ...item });
  }

  return values.length > 0 ? values : null;
}

function buildEnvironmentalSnapshot(
  database: LocalDatabase,
  job: LocalJobRow,
  environment: NonNullable<SaveLocalExecutionInput["environment"]>,
  metadata: {
    recordedAt: string;
    recordedBy: string;
  },
) {
  const assetSnapshot = parseJsonRecord(job.asset_snapshot_json);
  const assetTypeId =
    job.asset_type_remote_id ??
    getNumber(assetSnapshot, "assetTypeId") ??
    stableLocalNumericId(job.asset_id);
  const effectiveLimits = getLocalEffectiveEnvironmentalLimits(database, {
    assetTypeId,
    unitId: job.unit_id,
  });
  const limits = toEnvironmentalLimitsSnapshot(effectiveLimits);

  return {
    ...environment,
    ...metadata,
    limits,
    withinLimits: checkEnvironmentWithinLimits(environment, limits),
    outOfLimitsJustification: null,
  };
}

function toEnvironmentalLimitsSnapshot(
  row: Record<string, unknown> | null,
): Record<string, { min: number; max: number }> | null {
  if (!row) return null;

  const temperature = toLimitRange(row.temperatureMin, row.temperatureMax);
  const humidity = toLimitRange(row.humidityMin, row.humidityMax);
  const pressure = toLimitRange(row.pressureMin, row.pressureMax);
  const limits = {
    ...(temperature ? { temperature } : {}),
    ...(humidity ? { humidity } : {}),
    ...(pressure ? { pressure } : {}),
  };

  return Object.keys(limits).length > 0 ? limits : null;
}

function toLimitRange(min: unknown, max: unknown) {
  return typeof min === "number" && typeof max === "number"
    ? { min, max }
    : null;
}

function checkEnvironmentWithinLimits(
  environment: NonNullable<SaveLocalExecutionInput["environment"]>,
  limits: Record<string, { min: number; max: number }> | null,
) {
  if (!limits) return true;

  return (
    isWithinRange(environment.temperature, limits.temperature) &&
    isWithinRange(environment.humidity, limits.humidity) &&
    isWithinRange(environment.pressure, limits.pressure)
  );
}

function isWithinRange(
  value: number | null,
  range: { min: number; max: number } | undefined,
) {
  if (value == null || !range) return true;
  return value >= range.min && value <= range.max;
}

function appendLocalAudit(
  database: LocalDatabase,
  input: {
    entityType: string;
    entityId: string;
    action: string;
    actorUserId?: string | null;
    details: unknown;
    createdAt: string;
  },
) {
  database
    .prepare(
      `
INSERT INTO local_audit_log (
  id,
  entity_type,
  entity_id,
  action,
  actor_user_id,
  details_json,
  created_at,
  sync_state
) VALUES (
  @id,
  @entityType,
  @entityId,
  @action,
  @actorUserId,
  @detailsJson,
  @createdAt,
  'local'
)
`,
    )
    .run({
      id: `audit:${randomUUID()}`,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      actorUserId: input.actorUserId ?? null,
      detailsJson: JSON.stringify(input.details),
      createdAt: input.createdAt,
    });
}

function appendOutboxEvent(
  database: LocalDatabase,
  input: {
    entityType: string;
    entityId: string;
    operation: string;
    payload: unknown;
    actorUserId?: string | null;
    deviceId?: string | null;
    occurredAt: string;
  },
) {
  const eventId = `event:${randomUUID()}`;
  const idempotencyKey = `local:${eventId}`;
  const metadata = {
    actorUserId: input.actorUserId ?? null,
    deviceId: input.deviceId ?? "local",
  };

  database
    .prepare(
      `
INSERT INTO domain_events (
  event_id,
  aggregate_kind,
  aggregate_id,
  aggregate_version,
  event_type,
  payload_json,
  metadata_json,
  actor_user_id,
  device_id,
  occurred_at,
  sync_state
) VALUES (
  @eventId,
  @aggregateKind,
  @aggregateId,
  0,
  @eventType,
  @payloadJson,
  @metadataJson,
  @actorUserId,
  @deviceId,
  @occurredAt,
  'pending'
)
`,
    )
    .run({
      eventId,
      aggregateKind: input.entityType,
      aggregateId: input.entityId,
      eventType: input.operation,
      payloadJson: JSON.stringify(input.payload),
      metadataJson: JSON.stringify(metadata),
      actorUserId: input.actorUserId ?? null,
      deviceId: input.deviceId ?? "local",
      occurredAt: input.occurredAt,
    });

  database
    .prepare(
      `
INSERT INTO outbox (
  id,
  event_id,
  operation,
  payload_json,
  idempotency_key,
  status,
  created_at
) VALUES (
  @id,
  @eventId,
  @operation,
  @payloadJson,
  @idempotencyKey,
  'pending',
  @createdAt
)
`,
    )
    .run({
      id: `outbox:${randomUUID()}`,
      eventId,
      operation: input.operation,
      payloadJson: JSON.stringify(input.payload),
      idempotencyKey,
      createdAt: input.occurredAt,
    });
}

function nextLocalJobId(database: LocalDatabase) {
  const year = new Date().getFullYear();
  const row = database
    .prepare<{ prefix: string }, { total: number }>(
      `
SELECT COUNT(*) AS total
FROM calibration_jobs
WHERE job_id LIKE @prefix
`,
    )
    .get({ prefix: `LOCAL-${year}-%` });

  return `LOCAL-${year}-${String((row?.total ?? 0) + 1).padStart(4, "0")}`;
}

function getArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function recordFromUnknown(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

function isJsonObject(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function getString(row: JsonRecord, key: string) {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getNullableString(row: JsonRecord, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function parseJson(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    return null;
  }
}

function parseJsonRecord(value: string | null | undefined) {
  const parsed = parseJson(value);
  return recordFromUnknown(parsed);
}

function parseJsonRecordOrNull(value: string | null | undefined) {
  const parsed = parseJsonRecord(value);
  return Object.keys(parsed).length > 0 ? parsed : null;
}

function getCompiledNormalizedMethodJson(value: string | null | undefined) {
  const compiledMethod = parseJsonRecord(value);
  const normalizedMethodJson = compiledMethod.normalizedMethodJson;
  return typeof normalizedMethodJson === "string" ? normalizedMethodJson : null;
}

function getNumber(row: JsonRecord, key: string) {
  const value = row[key];
  return typeof value === "number" ? value : null;
}

function getNullableNumber(row: JsonRecord, key: string) {
  return getNumber(row, key);
}

type LocalAssetCommandRow = {
  id: string;
  remote_id: number | null;
  organization_id: string;
  unit_id: number;
  customer_id: string;
  asset_type_id: string;
  asset_type_remote_id: number | null;
  asset_type_name: string | null;
  asset_type_slug: string | null;
  name: string;
  serial_number: string;
  tag: string;
  manufacturer: string | null;
  model: string | null;
  base_measurement_unit: string | null;
  specifications_json: string | null;
};

type LocalServiceCommandRow = {
  id: string;
  remote_id: number | null;
  method_id: string | null;
  status: string;
};

type LocalPublishedMethodRow = {
  id: string;
  remote_id: number;
  name: string;
  version: number;
  method_fingerprint: string;
  engine_version: string;
  engine_options_fingerprint: string;
  normalized_method_json: string;
  compiled_method_json: string;
  publication_evidence_json: string | null;
};

type LocalReferenceStandardRow = {
  id: string;
  remote_id: number | null;
  name: string;
  certificate_number: string | null;
  next_calibration_date: string | null;
  status: string;
  snapshot_json: string;
  sync_state: string;
};

type LocalJobRow = {
  id: string;
  remote_id: number | null;
  job_id: string | null;
  unit_id: number;
  customer_id: string;
  asset_id: string;
  service_id: string;
  technician_id: string | null;
  method_snapshot_json: string;
  asset_snapshot_json: string;
  standards_snapshot_json: string | null;
  environmental_snapshot_json: string | null;
  calibration_location_snapshot_json: string | null;
  calibration_phase_snapshot_json: string | null;
  data_json: string | null;
  results_json: string | null;
  scope_compliance_status: string | null;
  scope_compliance_findings_json: string | null;
  scope_override_justification: string | null;
  method_deviations: string | null;
  status: LocalJobStatus;
  due_date: string | null;
  performed_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  certificate_url: string | null;
  created_at: string;
  updated_at: string;
  sync_state: string;
  customer_remote_id: number | null;
  customer_name: string | null;
  customer_tax_id: string | null;
  asset_remote_id: number | null;
  asset_name: string | null;
  asset_tag: string | null;
  asset_serial_number: string | null;
  asset_manufacturer: string | null;
  asset_model: string | null;
  asset_type_remote_id: number | null;
  asset_type_name: string | null;
  service_remote_id: number | null;
  service_name: string | null;
};
