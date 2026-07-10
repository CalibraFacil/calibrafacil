import { randomUUID } from "node:crypto";
import type { LocalDatabase } from "./database";
import { stableLocalNumericId } from "./ids";

export type LocalNonConformanceType =
  | "work"
  | "equipment"
  | "documentation"
  | "out_of_tolerance";

export type LocalNonConformanceStatus = "open" | "under_review" | "resolved";

export type CreateLocalNonConformanceInput = {
  organizationId?: string | null;
  unitId?: number | null;
  actorUserId?: string | null;
  deviceId?: string | null;
  type: LocalNonConformanceType;
  description: string;
  detectedAt: string;
};

export type LocalNonConformance = {
  id: number;
  ncNumber: string;
  jobId: number | null;
  type: LocalNonConformanceType;
  description: string;
  detectedBy: string | null;
  detectedAt: string;
  disposition: null;
  dispositionJustification: null;
  dispositionApprovedBy: null;
  dispositionApprovedAt: null;
  correctionTaken: null;
  resolvedAt: null;
  resolvedBy: null;
  status: LocalNonConformanceStatus;
  capaId: null;
  createdAt: string;
  updatedAt: string;
  detectedByName: string | null;
  ageDays: number;
  syncState: string;
};

export type LocalNonConformancesListInput = {
  page: number;
  limit: number;
  query?: string;
  status?: LocalNonConformanceStatus;
  type?: LocalNonConformanceType;
};

export type LocalNonConformancesListData = {
  data: LocalNonConformance[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export function createLocalNonConformance(
  database: LocalDatabase,
  input: CreateLocalNonConformanceInput,
): LocalNonConformance {
  if (!input.organizationId) {
    throw new Error("Contexto local sem organizacao ativa");
  }

  const detectedAtMs = Date.parse(input.detectedAt);
  if (!Number.isFinite(detectedAtMs)) {
    throw new Error("Data de deteccao invalida");
  }

  const now = new Date().toISOString();
  const localId = `non-conformance:local:${randomUUID()}`;
  const ncNumber = nextLocalNonConformanceNumber(database);
  const detectedAt = new Date(detectedAtMs).toISOString();
  // Matches the cloud `CreateNonConformanceSchema` payload the sync ingest
  // expects. `jobId` is deliberately absent: job linking is cloud-only in
  // Phase 0 of the offline NC capture (issue #426).
  const payload = {
    type: input.type,
    description: input.description,
    detectedAt,
  };

  database.transaction(() => {
    database
      .prepare(
        `
INSERT INTO non_conformances (
  id,
  remote_id,
  nc_number,
  organization_id,
  unit_id,
  type,
  description,
  detected_at,
  detected_by,
  status,
  created_at,
  updated_at,
  sync_state
) VALUES (
  @id,
  NULL,
  @ncNumber,
  @organizationId,
  @unitId,
  @type,
  @description,
  @detectedAt,
  @detectedBy,
  'open',
  @createdAt,
  @updatedAt,
  'local'
)
`,
      )
      .run({
        id: localId,
        ncNumber,
        organizationId: input.organizationId,
        unitId: input.unitId ?? null,
        type: input.type,
        description: input.description,
        detectedAt,
        detectedBy: input.actorUserId ?? null,
        createdAt: now,
        updatedAt: now,
      });

    appendLocalAudit(database, {
      entityType: "non_conformance",
      entityId: localId,
      action: "create",
      actorUserId: input.actorUserId,
      details: { ncNumber, type: input.type },
      createdAt: now,
    });
    appendOutboxEvent(database, {
      entityType: "non_conformance",
      entityId: localId,
      operation: "create_local_non_conformance",
      payload,
      actorUserId: input.actorUserId,
      deviceId: input.deviceId,
      occurredAt: now,
    });
  })();

  const created = getLocalNonConformanceByLocalId(database, localId);
  if (!created) {
    throw new Error("Falha ao registrar NC local");
  }

  return created;
}

export function listLocalNonConformances(
  database: LocalDatabase,
  input: LocalNonConformancesListInput,
): LocalNonConformancesListData {
  const page = Math.max(1, input.page);
  const limit = Math.max(1, Math.min(input.limit, 100));
  const offset = (page - 1) * limit;
  const conditions: string[] = [];
  const params: Record<string, string | number> = {};

  if (input.status) {
    conditions.push("status = @status");
    params.status = input.status;
  }

  if (input.type) {
    conditions.push("type = @type");
    params.type = input.type;
  }

  if (input.query) {
    conditions.push(`(
      nc_number LIKE @query OR
      description LIKE @query
    )`);
    params.query = `%${input.query}%`;
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const totalRow = database
    .prepare<typeof params, { total: number }>(
      `
SELECT COUNT(*) AS total
FROM non_conformances
${whereClause}
`,
    )
    .get(params);
  const pageParams = { ...params, limit, offset };
  const rows = database
    .prepare<typeof pageParams, LocalNonConformanceRow>(
      `
SELECT *
FROM non_conformances
${whereClause}
ORDER BY detected_at DESC
LIMIT @limit OFFSET @offset
`,
    )
    .all(pageParams);

  return {
    data: rows.map(toLocalNonConformance),
    pagination: {
      page,
      limit,
      total: totalRow?.total ?? 0,
      totalPages: Math.ceil((totalRow?.total ?? 0) / limit),
    },
  };
}

function getLocalNonConformanceByLocalId(
  database: LocalDatabase,
  localId: string,
) {
  const row = database
    .prepare<
      { localId: string },
      LocalNonConformanceRow
    >("SELECT * FROM non_conformances WHERE id = @localId")
    .get({ localId });

  return row ? toLocalNonConformance(row) : null;
}

function toLocalNonConformance(
  row: LocalNonConformanceRow,
): LocalNonConformance {
  const detectedAtMs = Date.parse(row.detected_at);
  const ageDays = Number.isFinite(detectedAtMs)
    ? Math.ceil((Date.now() - detectedAtMs) / (1000 * 60 * 60 * 24))
    : 0;

  return {
    id: row.remote_id ?? stableLocalNumericId(row.id),
    ncNumber: row.nc_number,
    jobId: null,
    type: row.type,
    description: row.description,
    detectedBy: row.detected_by,
    detectedAt: row.detected_at,
    disposition: null,
    dispositionJustification: null,
    dispositionApprovedBy: null,
    dispositionApprovedAt: null,
    correctionTaken: null,
    resolvedAt: null,
    resolvedBy: null,
    status: row.status,
    capaId: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    detectedByName: null,
    ageDays,
    syncState: row.sync_state,
  };
}

function nextLocalNonConformanceNumber(database: LocalDatabase) {
  const year = new Date().getFullYear();
  const row = database
    .prepare<{ prefix: string }, { total: number }>(
      `
SELECT COUNT(*) AS total
FROM non_conformances
WHERE nc_number LIKE @prefix
`,
    )
    .get({ prefix: `LOCAL-NC-${year}-%` });

  return `LOCAL-NC-${year}-${String((row?.total ?? 0) + 1).padStart(4, "0")}`;
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

type LocalNonConformanceRow = {
  id: string;
  remote_id: number | null;
  nc_number: string;
  organization_id: string;
  unit_id: number | null;
  type: LocalNonConformanceType;
  description: string;
  detected_at: string;
  detected_by: string | null;
  status: LocalNonConformanceStatus;
  created_at: string;
  updated_at: string;
  sync_state: string;
};
