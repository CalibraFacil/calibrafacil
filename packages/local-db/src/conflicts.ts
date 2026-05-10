import {
  localSyncConflictSchema,
  type LocalSyncConflict,
} from "@calibra-facil/contracts";
import type { LocalDatabase } from "./database";

export type ListSyncConflictsInput = {
  status?: "open" | "resolved" | "ignored";
  limit?: number;
};

export function listSyncConflicts(
  database: LocalDatabase,
  input: ListSyncConflictsInput = {},
) {
  const status = input.status ?? "open";
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const rows = database
    .prepare(
      `
SELECT id, event_id, entity_type, entity_id, local_payload_json, remote_payload_json,
  conflict_type, status, created_at, resolved_at
FROM sync_conflicts
WHERE status = @status
ORDER BY created_at DESC
LIMIT @limit
`,
    )
    .all({ status, limit }) as SyncConflictRow[];

  const totalRow = database
    .prepare(
      `
SELECT COUNT(*) AS total
FROM sync_conflicts
WHERE status = @status
`,
    )
    .get({ status }) as { total: number } | undefined;

  return {
    data: rows.map(mapConflictRow),
    total: totalRow?.total ?? 0,
  };
}

export function resolveSyncConflict(
  database: LocalDatabase,
  id: string,
  status: "resolved" | "ignored" = "resolved",
): LocalSyncConflict | null {
  const existing = getSyncConflict(database, id);
  if (!existing) return null;

  database.transaction(() => {
    database
      .prepare(
        `
UPDATE sync_conflicts
SET status = @status,
  resolved_at = @resolvedAt
WHERE id = @id
`,
      )
      .run({
        id,
        status,
        resolvedAt: new Date().toISOString(),
      });

    if (status === "resolved") {
      moveConflictedEvents(database, existing.eventId, existing.entityId, {
        outboxStatus: "pending",
        eventSyncState: "pending",
        lastError: null,
      });
    } else {
      moveConflictedEvents(database, existing.eventId, existing.entityId, {
        outboxStatus: "synced",
        eventSyncState: "synced",
        lastError: null,
      });
    }
  })();

  return getSyncConflict(database, id);
}

function moveConflictedEvents(
  database: LocalDatabase,
  eventId: string | null,
  entityId: string,
  input: {
    outboxStatus: "pending" | "synced";
    eventSyncState: "pending" | "synced";
    lastError: string | null;
  },
) {
  database
    .prepare(
      `
UPDATE outbox
SET status = @outboxStatus,
  last_error = @lastError,
  next_attempt_at = NULL
WHERE event_id IN (
  SELECT event_id
  FROM domain_events
  WHERE (
      (@eventId IS NOT NULL AND event_id = @eventId)
      OR (@eventId IS NULL AND aggregate_id = @entityId)
    )
    AND sync_state = 'conflict'
)
`,
    )
    .run({
      eventId,
      entityId,
      outboxStatus: input.outboxStatus,
      lastError: input.lastError,
    });

  database
    .prepare(
      `
UPDATE domain_events
SET sync_state = @eventSyncState
WHERE aggregate_id = @entityId
  AND (@eventId IS NULL OR event_id = @eventId)
  AND sync_state = 'conflict'
`,
    )
    .run({
      eventId,
      entityId,
      eventSyncState: input.eventSyncState,
    });
}

export function getSyncConflict(database: LocalDatabase, id: string) {
  const row = database
    .prepare(
      `
SELECT id, event_id, entity_type, entity_id, local_payload_json, remote_payload_json,
  conflict_type, status, created_at, resolved_at
FROM sync_conflicts
WHERE id = @id
LIMIT 1
`,
    )
    .get({ id }) as SyncConflictRow | undefined;

  return row ? mapConflictRow(row) : null;
}

function mapConflictRow(row: SyncConflictRow): LocalSyncConflict {
  return localSyncConflictSchema.parse({
    id: row.id,
    eventId: row.event_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    localPayload: parseJson(row.local_payload_json),
    remotePayload: parseJson(row.remote_payload_json),
    conflictType: row.conflict_type,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  });
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

type SyncConflictRow = {
  id: string;
  event_id: string | null;
  entity_type: string;
  entity_id: string;
  local_payload_json: string;
  remote_payload_json: string;
  conflict_type: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
};
