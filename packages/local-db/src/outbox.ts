import type { SyncPushResponse } from "@calibra-facil/contracts";
import { stringifySyncConflictPayload } from "@calibra-facil/sync";
import type { LocalDatabase } from "./database";

export type PendingOutboxEvent = {
  eventId: string;
  entityType: string;
  entityId: string;
  operation: string;
  payload: unknown;
  occurredAt: string;
  actorUserId: string | null;
  deviceId: string;
  idempotencyKey: string;
  localVersion: number;
  // Base version the local edit was made against (the cloud row's `updatedAt`
  // captured at pull time), or null when the row was never pulled / is legacy.
  baseUpdatedAt: string | null;
};

export function countPendingOutbox(database: LocalDatabase) {
  const row = database
    .prepare<[], { total: number }>(
      `
SELECT COUNT(*) AS total
FROM outbox
WHERE status IN ('pending', 'failed')
`,
    )
    .get();

  return row?.total ?? 0;
}

export function countOpenSyncConflicts(database: LocalDatabase) {
  const row = database
    .prepare<[], { total: number }>(
      `
SELECT COUNT(*) AS total
FROM sync_conflicts
WHERE status = 'open'
`,
    )
    .get();

  return row?.total ?? 0;
}

export function getSyncCursor(database: LocalDatabase, scope = "default") {
  const row = database
    .prepare<
      [string],
      { cursor: string | null }
    >("SELECT cursor FROM sync_cursors WHERE scope = ?")
    .get(scope);

  return row?.cursor ?? null;
}

export function getSyncCursorUpdatedAt(
  database: LocalDatabase,
  scope = "default",
) {
  const row = database
    .prepare<
      [string],
      { updated_at: string | null }
    >("SELECT updated_at FROM sync_cursors WHERE scope = ?")
    .get(scope);

  return row?.updated_at ?? null;
}

export function setSyncCursor(
  database: LocalDatabase,
  cursor: string | null,
  scope = "default",
) {
  database
    .prepare(
      `
INSERT INTO sync_cursors (scope, cursor, updated_at)
VALUES (@scope, @cursor, @updatedAt)
ON CONFLICT(scope) DO UPDATE SET
  cursor = excluded.cursor,
  updated_at = excluded.updated_at
`,
    )
    .run({
      scope,
      cursor,
      updatedAt: new Date().toISOString(),
    });
}

export function listPendingOutboxEvents(
  database: LocalDatabase,
  limit = 50,
  options: { includeDeferred?: boolean } = {},
): PendingOutboxEvent[] {
  const now = new Date().toISOString();
  const rows = database
    .prepare<
      { now: string; limit: number; includeDeferred: number },
      PendingOutboxEventRow
    >(
      `
SELECT
  domain_events.event_id,
  domain_events.aggregate_kind,
  domain_events.aggregate_id,
  domain_events.aggregate_version,
  domain_events.event_type,
  domain_events.payload_json,
  domain_events.actor_user_id,
  domain_events.device_id,
  domain_events.occurred_at,
  outbox.idempotency_key,
  CASE domain_events.aggregate_kind
    WHEN 'asset' THEN (
      SELECT remote_base_updated_at FROM assets
      WHERE assets.id = domain_events.aggregate_id
    )
    WHEN 'customer' THEN (
      SELECT remote_base_updated_at FROM customers
      WHERE customers.id = domain_events.aggregate_id
    )
    WHEN 'service_order_execution' THEN (
      SELECT remote_base_updated_at FROM service_order_executions
      WHERE service_order_executions.id = domain_events.aggregate_id
    )
    ELSE NULL
  END AS remote_base_updated_at
FROM outbox
INNER JOIN domain_events ON domain_events.event_id = outbox.event_id
WHERE outbox.status IN ('pending', 'failed')
  AND (
    @includeDeferred = 1
    OR outbox.next_attempt_at IS NULL
    OR outbox.next_attempt_at <= @now
  )
ORDER BY outbox.created_at ASC
LIMIT @limit
`,
    )
    .all({
      now,
      limit,
      includeDeferred: options.includeDeferred ? 1 : 0,
    });

  return rows.map((row) => ({
    eventId: row.event_id,
    entityType: row.aggregate_kind,
    entityId: row.aggregate_id,
    operation: row.event_type,
    payload: parseJson(row.payload_json),
    occurredAt: row.occurred_at,
    actorUserId: row.actor_user_id,
    deviceId: row.device_id,
    idempotencyKey: row.idempotency_key,
    localVersion: row.aggregate_version,
    baseUpdatedAt: row.remote_base_updated_at,
  }));
}

export function markOutboxEventsFailedForRetry(
  database: LocalDatabase,
  eventIds: string[],
  errorMessage: string,
) {
  if (eventIds.length === 0) return;

  const rows = database
    .prepare<string[], { event_id: string; attempt_count: number }>(
      `
SELECT event_id, attempt_count
FROM outbox
WHERE event_id IN (${eventIds.map(() => "?").join(",")})
`,
    )
    .all(...eventIds);

  database.transaction(() => {
    for (const row of rows) {
      const nextAttemptAt = new Date(
        Date.now() + getOutboxRetryDelayMs(row.attempt_count),
      ).toISOString();

      database
        .prepare(
          `
UPDATE outbox
SET status = 'failed',
  attempt_count = attempt_count + 1,
  last_error = @lastError,
  next_attempt_at = @nextAttemptAt
WHERE event_id = @eventId
`,
        )
        .run({
          eventId: row.event_id,
          lastError: errorMessage,
          nextAttemptAt,
        });
      database
        .prepare(
          `
UPDATE domain_events
SET sync_state = 'failed'
WHERE event_id = @eventId
`,
        )
        .run({ eventId: row.event_id });
    }
  })();
}

export function applySyncPushResult(
  database: LocalDatabase,
  response: SyncPushResponse,
) {
  const acceptedIds = new Set(response.accepted.map((item) => item.eventId));
  const acceptedById = new Map(
    response.accepted.map((item) => [item.eventId, item]),
  );
  const rejectedById = new Map(
    response.rejected.map((item) => [item.eventId, item]),
  );
  const conflictEventIds = response.conflicts
    .map((conflict) => conflict.eventId)
    .filter((eventId): eventId is string => typeof eventId === "string");
  const now = new Date().toISOString();
  const eventsById = getEventsById(database, [
    ...acceptedIds,
    ...rejectedById.keys(),
    ...conflictEventIds,
  ]);

  database.transaction(() => {
    for (const [eventId, accepted] of acceptedById) {
      database
        .prepare(
          `
UPDATE outbox
SET status = 'synced',
  last_error = NULL,
  next_attempt_at = NULL
WHERE event_id = @eventId
`,
        )
        .run({ eventId });
      database
        .prepare(
          `
UPDATE domain_events
SET sync_state = 'synced'
WHERE event_id = @eventId
`,
        )
        .run({ eventId });
      applyAcceptedRemoteEntity(database, eventsById.get(eventId), accepted);
    }

    for (const [eventId, rejection] of rejectedById) {
      database
        .prepare(
          `
UPDATE outbox
SET status = 'failed',
  attempt_count = attempt_count + 1,
  last_error = @lastError,
  next_attempt_at = NULL
WHERE event_id = @eventId
`,
        )
        .run({
          eventId,
          lastError: `${rejection.code}: ${rejection.reason}`,
        });
      database
        .prepare(
          `
UPDATE domain_events
SET sync_state = 'failed'
WHERE event_id = @eventId
`,
        )
        .run({ eventId });
    }

    for (const conflict of response.conflicts) {
      if (conflict.eventId) {
        database
          .prepare(
            `
UPDATE outbox
SET status = 'conflict',
  last_error = @lastError,
  next_attempt_at = NULL
WHERE event_id = @eventId
`,
          )
          .run({
            eventId: conflict.eventId,
            lastError: `${conflict.conflictType}: conflict requires review`,
          });
        database
          .prepare(
            `
UPDATE domain_events
SET sync_state = 'conflict'
WHERE event_id = @eventId
`,
          )
          .run({ eventId: conflict.eventId });
      }

      const event = conflict.eventId
        ? eventsById.get(conflict.eventId)
        : undefined;
      database
        .prepare(
          `
INSERT OR IGNORE INTO sync_conflicts (
  id,
  event_id,
  entity_type,
  entity_id,
  local_payload_json,
  remote_payload_json,
  conflict_type,
  status,
  created_at
) VALUES (
  @id,
  @eventId,
  @entityType,
  @entityId,
  @localPayloadJson,
  @remotePayloadJson,
  @conflictType,
  @status,
  @createdAt
)
`,
        )
        .run({
          id: conflict.id,
          eventId: conflict.eventId ?? null,
          entityType: conflict.entityType,
          entityId: conflict.entityId,
          localPayloadJson: stringifySyncConflictPayload(
            conflict.localPayload ??
              (event ? parseJson(event.payload_json) : null),
          ),
          remotePayloadJson: stringifySyncConflictPayload(
            conflict.remotePayload ?? null,
          ),
          conflictType: conflict.conflictType,
          status: conflict.status,
          createdAt: now,
        });
    }

    if (response.newCursor !== undefined) {
      setSyncCursor(database, response.newCursor);
    }
  })();
}

function getOutboxRetryDelayMs(attemptCount: number) {
  const baseDelayMs = 30_000;
  const maxDelayMs = 5 * 60_000;
  return Math.min(maxDelayMs, baseDelayMs * 2 ** attemptCount);
}

function getEventsById(database: LocalDatabase, eventIds: string[]) {
  if (eventIds.length === 0) {
    return new Map<string, DomainEventRow>();
  }

  const rows = database
    .prepare<string[], DomainEventRow>(
      `
SELECT event_id, aggregate_kind, aggregate_id, payload_json
FROM domain_events
WHERE event_id IN (${eventIds.map(() => "?").join(",")})
`,
    )
    .all(...eventIds);

  return new Map(rows.map((row) => [row.event_id, row]));
}

function applyAcceptedRemoteEntity(
  database: LocalDatabase,
  event: DomainEventRow | undefined,
  accepted: SyncPushResponse["accepted"][number],
) {
  if (!event || accepted.remoteEntityId === undefined) return;

  if (
    event.aggregate_kind === "calibration_job" &&
    typeof accepted.remoteEntityId === "number"
  ) {
    const remoteEntity = asRecord(accepted.remoteEntity);
    const officialJobId = getString(remoteEntity, "jobId");
    database
      .prepare(
        `
UPDATE calibration_jobs
SET remote_id = @remoteId,
  job_id = COALESCE(@officialJobId, job_id),
  sync_state = 'synced'
WHERE id = @localId
`,
      )
      .run({
        remoteId: accepted.remoteEntityId,
        officialJobId,
        localId: event.aggregate_id,
      });
  }

  if (
    event.aggregate_kind === "asset" &&
    typeof accepted.remoteEntityId === "number"
  ) {
    database
      .prepare(
        `
UPDATE assets
SET remote_id = @remoteId,
  sync_state = 'synced'
WHERE id = @localId
`,
      )
      .run({
        remoteId: accepted.remoteEntityId,
        localId: event.aggregate_id,
      });
  }

  if (
    event.aggregate_kind === "customer" &&
    typeof accepted.remoteEntityId === "number"
  ) {
    database
      .prepare(
        `
UPDATE customers
SET remote_id = @remoteId,
  sync_state = 'synced'
WHERE id = @localId
`,
      )
      .run({
        remoteId: accepted.remoteEntityId,
        localId: event.aggregate_id,
      });
  }

  if (event.aggregate_kind === "attachment") {
    database
      .prepare(
        `
UPDATE attachments
SET upload_status = 'synced',
  remote_key = COALESCE(@remoteKey, remote_key)
WHERE id = @localId
`,
      )
      .run({
        remoteKey:
          typeof accepted.remoteEntityId === "string"
            ? accepted.remoteEntityId
            : null,
        localId: event.aggregate_id,
      });
  }

  if (event.aggregate_kind === "certificate_draft") {
    const remoteEntity = asRecord(accepted.remoteEntity);
    const payload = asRecord(parseJson(event.payload_json));
    const localJobId = getString(payload, "jobId");
    const certificateUrl = getString(remoteEntity, "certificateUrl");
    const status = getString(remoteEntity, "status");
    database
      .prepare(
        `
UPDATE certificate_drafts
SET sync_state = 'synced'
WHERE id = @localId
`,
      )
      .run({
        localId: event.aggregate_id,
      });

    if (localJobId && certificateUrl) {
      database
        .prepare(
          `
UPDATE calibration_jobs
SET certificate_url = @certificateUrl,
  status = COALESCE(@status, status),
  sync_state = 'synced'
WHERE id = @localJobId
`,
        )
        .run({
          certificateUrl,
          status,
          localJobId,
        });
    }
  }

  if (
    event.aggregate_kind === "service_order" &&
    typeof accepted.remoteEntityId === "number"
  ) {
    const remoteEntity = asRecord(accepted.remoteEntity);
    const officialServiceOrderNumber = getString(
      remoteEntity,
      "serviceOrderNumber",
    );
    const status = getString(remoteEntity, "status");
    database
      .prepare(
        `
UPDATE service_orders
SET remote_id = @remoteId,
  service_order_number = COALESCE(@officialServiceOrderNumber, service_order_number),
  status = COALESCE(@status, status),
  sync_state = 'synced'
WHERE id = @localId
`,
      )
      .run({
        remoteId: accepted.remoteEntityId,
        officialServiceOrderNumber,
        status,
        localId: event.aggregate_id,
      });
  }

  if (
    event.aggregate_kind === "service_order_quote" &&
    typeof accepted.remoteEntityId === "number"
  ) {
    database
      .prepare(
        `
UPDATE service_order_quotes
SET remote_id = @remoteId,
  sync_state = 'synced'
WHERE id = @localId
`,
      )
      .run({
        remoteId: accepted.remoteEntityId,
        localId: event.aggregate_id,
      });
  }

  if (
    event.aggregate_kind === "service_order_execution" &&
    typeof accepted.remoteEntityId === "number"
  ) {
    const remoteEntity = asRecord(accepted.remoteEntity);
    const status = getString(remoteEntity, "status");
    const localServiceOrderId = getString(
      asRecord(parseJson(event.payload_json)),
      "serviceOrderId",
    );
    database
      .prepare(
        `
UPDATE service_order_executions
SET remote_id = @remoteId,
  sync_state = 'synced'
WHERE id = @localId
`,
      )
      .run({
        remoteId: accepted.remoteEntityId,
        localId: event.aggregate_id,
      });

    if (localServiceOrderId && status) {
      database
        .prepare(
          `
UPDATE service_orders
SET status = @status,
  sync_state = 'synced'
WHERE id = @localServiceOrderId
`,
        )
        .run({ status, localServiceOrderId });
    }
  }

  if (
    event.aggregate_kind === "service_order_delivery_document" &&
    typeof accepted.remoteEntityId === "number"
  ) {
    const remoteEntity = asRecord(accepted.remoteEntity);
    const issuedAt = getString(remoteEntity, "issuedAt");
    database
      .prepare(
        `
UPDATE service_order_delivery_documents
SET remote_id = @remoteId,
  issued_at = COALESCE(@issuedAt, issued_at),
  sync_state = 'synced'
WHERE id = @localId
`,
      )
      .run({
        remoteId: accepted.remoteEntityId,
        issuedAt,
        localId: event.aggregate_id,
      });
  }
}

function parseJson(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    return null;
  }
}

type PendingOutboxEventRow = {
  event_id: string;
  aggregate_kind: string;
  aggregate_id: string;
  aggregate_version: number;
  event_type: string;
  payload_json: string;
  actor_user_id: string | null;
  device_id: string;
  occurred_at: string;
  idempotency_key: string;
  remote_base_updated_at: string | null;
};

type DomainEventRow = {
  event_id: string;
  aggregate_kind: string;
  aggregate_id: string;
  payload_json: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

function getString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
