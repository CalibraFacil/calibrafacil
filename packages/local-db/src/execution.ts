import { randomUUID } from "node:crypto";
import type { LocalDatabase } from "./database";
import { getLocalEffectiveEnvironmentalLimits } from "./environmental-limits";
import { stableLocalNumericId } from "./ids";
import type { LocalJobStatus } from "./jobs";

type JsonRecord = Record<string, unknown>;

export type LocalJobCommandInput = {
  actorUserId?: string | null;
  deviceId?: string | null;
};

export type LocalCertificateDraft = {
  id: string;
  jobId: string;
  localPath: string | null;
  status: string;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
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
    validations: getArray(methodPayload.validations),
    uncertaintyParams: getArray(methodPayload.uncertaintyParams),
    certificateContent: methodPayload.certificateContent ?? null,
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
  'DRAFT',
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

  if (!["DRAFT", "IN_PROGRESS", "REJECTED"].includes(existing.status)) {
    throw new Error(
      `Nao e possivel executar um job com status ${existing.status}`,
    );
  }

  const now = new Date().toISOString();
  const nextStatus: LocalJobStatus =
    input.requireResults || existing.status === "REVIEW"
      ? "REVIEW"
      : existing.status === "DRAFT"
        ? "IN_PROGRESS"
        : existing.status;
  const standardsSnapshot = buildStandardsSnapshot(
    database,
    input.selectedStandardIds,
  );
  const environmentalSnapshot = input.environment
    ? buildEnvironmentalSnapshot(database, existing, input.environment, {
        recordedAt: now,
        recordedBy: input.actorUserId ?? "local",
      })
    : parseJson(existing.environmental_snapshot_json);

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
  status = @status,
  submitted_at = @submittedAt,
  updated_at = @updatedAt,
  sync_state = 'local'
WHERE id = @id
`,
      )
      .run({
        id: existing.id,
        dataJson: JSON.stringify(input.data),
        resultsJson: JSON.stringify(input.results ?? null),
        standardsSnapshotJson:
          standardsSnapshot === undefined
            ? existing.standards_snapshot_json
            : JSON.stringify(standardsSnapshot),
        environmentalSnapshotJson: JSON.stringify(environmentalSnapshot),
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
      },
      createdAt: now,
    });
    appendOutboxEvent(database, {
      entityType: "calibration_job",
      entityId: existing.id,
      operation:
        nextStatus === "REVIEW"
          ? "submit_local_execution"
          : "save_local_execution",
      payload: {
        data: input.data,
        results: input.results ?? null,
        standardsSnapshot,
        environmentalSnapshot,
        status: nextStatus,
      },
      actorUserId: input.actorUserId,
      deviceId: input.deviceId,
      occurredAt: now,
    });
  })();

  return getLocalJobDetail(database, input.routeId);
}

export function createLocalCertificateDraft(
  database: LocalDatabase,
  routeId: string,
  input: LocalJobCommandInput & {
    draftId?: string;
    localPath?: string;
    metadata?: JsonRecord;
  } = {},
) {
  const job = findLocalJob(database, routeId);
  if (!job) {
    throw new Error("Job nao encontrado");
  }

  const now = new Date().toISOString();
  const draftId = input.draftId ?? `certificate-draft:${randomUUID()}`;
  const localPath =
    input.localPath ?? buildLocalCertificateDraftPath(job.id, draftId);
  const metadata = {
    jobId: job.job_id,
    generatedAt: now,
    contentType: "text/html",
    draftKind: "local_certificate_html",
    ...input.metadata,
  };

  database.transaction(() => {
    database
      .prepare(
        `
INSERT INTO certificate_drafts (
  id,
  job_id,
  local_path,
  status,
  metadata_json,
  created_at,
  updated_at,
  sync_state
) VALUES (
  @id,
  @jobId,
  @localPath,
  'draft',
  @metadataJson,
  @createdAt,
  @updatedAt,
  'local'
)
`,
      )
      .run({
        id: draftId,
        jobId: job.id,
        localPath,
        metadataJson: JSON.stringify(metadata),
        createdAt: now,
        updatedAt: now,
      });

    database
      .prepare(
        `
UPDATE calibration_jobs
SET local_certificate_path = @localPath,
  updated_at = @updatedAt,
  sync_state = 'local'
WHERE id = @jobId
`,
      )
      .run({
        jobId: job.id,
        localPath,
        updatedAt: now,
      });

    appendLocalAudit(database, {
      entityType: "certificate_draft",
      entityId: draftId,
      action: "create",
      actorUserId: input.actorUserId,
      details: { jobId: job.id, localPath },
      createdAt: now,
    });
    appendOutboxEvent(database, {
      entityType: "certificate_draft",
      entityId: draftId,
      operation: "create_local_certificate_draft",
      payload: { draftId, jobId: job.id, localPath, metadata },
      actorUserId: input.actorUserId,
      deviceId: input.deviceId,
      occurredAt: now,
    });
  })();

  return {
    id: draftId,
    jobId: job.id,
    localPath,
    status: "draft",
    metadata,
    createdAt: now,
    updatedAt: now,
  };
}

export function getLatestLocalCertificateDraft(
  database: LocalDatabase,
  routeId: string,
): LocalCertificateDraft | null {
  const job = findLocalJob(database, routeId);
  if (!job) return null;

  const row = database
    .prepare(
      `
SELECT *
FROM certificate_drafts
WHERE job_id = @jobId
ORDER BY created_at DESC
LIMIT 1
`,
    )
    .get({ jobId: job.id }) as LocalCertificateDraftRow | undefined;

  return row ? toLocalCertificateDraft(row) : null;
}

export function saveLocalCertificateDraftPdf(
  database: LocalDatabase,
  routeId: string,
  input: LocalJobCommandInput & {
    draftId: string;
    localPath: string;
    contentHash: string;
    sizeBytes: number;
  },
) {
  const job = findLocalJob(database, routeId);
  if (!job) {
    throw new Error("Job nao encontrado");
  }

  const existing = database
    .prepare(
      `
SELECT *
FROM certificate_drafts
WHERE id = @draftId AND job_id = @jobId
`,
    )
    .get({
      draftId: input.draftId,
      jobId: job.id,
    }) as LocalCertificateDraftRow | undefined;

  if (!existing) {
    throw new Error("Rascunho de certificado local nao encontrado");
  }

  const now = new Date().toISOString();
  const metadata = {
    ...parseJsonRecord(existing.metadata_json),
    pdfPath: input.localPath,
    pdfContentHash: input.contentHash,
    pdfSizeBytes: input.sizeBytes,
    pdfGeneratedAt: now,
    pdfContentType: "application/pdf",
  };

  database.transaction(() => {
    database
      .prepare(
        `
UPDATE certificate_drafts
SET status = 'pdf_generated',
  metadata_json = @metadataJson,
  updated_at = @updatedAt,
  sync_state = 'local'
WHERE id = @draftId
`,
      )
      .run({
        draftId: input.draftId,
        metadataJson: JSON.stringify(metadata),
        updatedAt: now,
      });

    database
      .prepare(
        `
UPDATE calibration_jobs
SET local_certificate_path = @localPath,
  updated_at = @updatedAt,
  sync_state = 'local'
WHERE id = @jobId
`,
      )
      .run({
        jobId: job.id,
        localPath: input.localPath,
        updatedAt: now,
      });

    appendLocalAudit(database, {
      entityType: "certificate_draft",
      entityId: input.draftId,
      action: "generate_pdf",
      actorUserId: input.actorUserId,
      details: {
        jobId: job.id,
        localPath: input.localPath,
        contentHash: input.contentHash,
        sizeBytes: input.sizeBytes,
      },
      createdAt: now,
    });
    appendOutboxEvent(database, {
      entityType: "certificate_draft",
      entityId: input.draftId,
      operation: "generate_local_certificate_pdf",
      payload: {
        draftId: input.draftId,
        jobId: job.id,
        localPath: input.localPath,
        contentHash: input.contentHash,
        sizeBytes: input.sizeBytes,
      },
      actorUserId: input.actorUserId,
      deviceId: input.deviceId,
      occurredAt: now,
    });
  })();

  return getLatestLocalCertificateDraft(database, routeId);
}

export function buildLocalCertificateDraftPath(jobId: string, draftId: string) {
  return `certificates/${toSafePathSegment(jobId)}/${toSafePathSegment(
    draftId,
  )}.html`;
}

export function buildLocalCertificateDraftPdfPath(
  jobId: string,
  draftId: string,
) {
  return `certificates/${toSafePathSegment(jobId)}/${toSafePathSegment(
    draftId,
  )}.pdf`;
}

function findLocalJob(database: LocalDatabase, routeId: string) {
  const remoteId = Number(routeId);
  if (Number.isFinite(remoteId)) {
    const remoteMatch = database
      .prepare(
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
      .get({ remoteId }) as LocalJobRow | undefined;
    if (remoteMatch) return remoteMatch;
  }

  const rows = database
    .prepare(
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
    .all() as LocalJobRow[];

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
    dueDate: job.due_date,
    performedAt: job.performed_at,
    submittedAt: job.submitted_at,
    approvedAt: job.approved_at,
    rejectedAt: job.rejected_at,
    certificateUrl: job.certificate_url,
    localCertificatePath: job.local_certificate_path,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    syncState: job.sync_state,
  };
}

function getAssetByRemoteId(database: LocalDatabase, remoteId: number) {
  const remoteRow = database
    .prepare(
      `
SELECT a.*, at.remote_id AS asset_type_remote_id, at.name AS asset_type_name,
  NULL AS asset_type_slug
FROM assets a
LEFT JOIN asset_types at ON at.id = a.asset_type_id
WHERE a.remote_id = @remoteId AND a.deleted_at IS NULL
`,
    )
    .get({ remoteId }) as LocalAssetCommandRow | undefined;
  if (remoteRow) return remoteRow;

  const rows = database
    .prepare(
      `
SELECT a.*, at.remote_id AS asset_type_remote_id, at.name AS asset_type_name,
  NULL AS asset_type_slug
FROM assets a
LEFT JOIN asset_types at ON at.id = a.asset_type_id
WHERE a.deleted_at IS NULL
`,
    )
    .all() as LocalAssetCommandRow[];

  return rows.find((row) => stableLocalNumericId(row.id) === remoteId);
}

function getServiceByRemoteId(database: LocalDatabase, remoteId: number) {
  return database
    .prepare("SELECT * FROM services WHERE remote_id = @remoteId")
    .get({ remoteId }) as LocalServiceCommandRow | undefined;
}

function getPublishedMethod(database: LocalDatabase, localMethodId: string) {
  return database
    .prepare("SELECT * FROM published_methods WHERE id = @id")
    .get({ id: localMethodId }) as LocalPublishedMethodRow | undefined;
}

function buildStandardsSnapshot(
  database: LocalDatabase,
  selectedStandardIds: number[] | undefined,
) {
  if (selectedStandardIds === undefined) return undefined;
  if (selectedStandardIds.length === 0) return [];

  const rows = database
    .prepare(
      `
SELECT *
FROM reference_standards
WHERE remote_id IN (${selectedStandardIds.map(() => "?").join(",")})
`,
    )
    .all(...selectedStandardIds) as LocalReferenceStandardRow[];

  return rows.map((row) => ({
    id: row.remote_id ?? stableLocalNumericId(row.id),
    name: row.name,
    certificateNumber: row.certificate_number ?? "",
    calibrationDate: "",
    nextCalibrationDate: row.next_calibration_date,
    uncertainty: null,
    uncertaintyUnit: null,
    coverageFactor: 2,
    distribution: "normal",
    drift: null,
    certifiedValues: null,
  }));
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
    .prepare(
      `
SELECT COUNT(*) AS total
FROM calibration_jobs
WHERE job_id LIKE @prefix
`,
    )
    .get({ prefix: `LOCAL-${year}-%` }) as { total: number };

  return `LOCAL-${year}-${String(row.total + 1).padStart(4, "0")}`;
}

function getArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function parseJson(value: string | null | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseJsonRecord(value: string | null | undefined) {
  const parsed = parseJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as JsonRecord)
    : {};
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

function toSafePathSegment(value: string) {
  return (
    value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "local"
  );
}

function toLocalCertificateDraft(
  row: LocalCertificateDraftRow,
): LocalCertificateDraft {
  return {
    id: row.id,
    jobId: row.job_id,
    localPath: row.local_path,
    status: row.status,
    metadata: parseJson(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
};

type LocalCertificateDraftRow = {
  id: string;
  job_id: string;
  local_path: string | null;
  status: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
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
  data_json: string | null;
  results_json: string | null;
  status: LocalJobStatus;
  due_date: string | null;
  performed_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  certificate_url: string | null;
  local_certificate_path: string | null;
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
