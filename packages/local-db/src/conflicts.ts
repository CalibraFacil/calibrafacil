import {
  isRegulatedOutboxOperation,
  localSyncConflictSchema,
  type LocalSyncConflict,
} from "@calibra-facil/contracts";
import type { LocalDatabase } from "./database";
import { rebaseQueuedJobEvents } from "./outbox";
import {
  recomputeBlockedOutbox,
  recordAggregateVersion,
} from "./outbox-ordering";
import { releaseSettledSkippedRows } from "./skipped-rows";

export type ListSyncConflictsInput = {
  status?: LocalSyncConflict["status"];
  limit?: number;
};

/**
 * Discarding a regulated change (calibration readings) needs a written reason: the readings
 * were taken at the bench and the cloud will never receive them.
 */
export class SyncConflictReasonRequiredError extends Error {
  constructor() {
    super("Informe o motivo para descartar leituras de calibração.");
    this.name = "SyncConflictReasonRequiredError";
  }
}

export type ResolveSyncConflictOptions = {
  /** The signed-in user who decided: recorded with the decision. */
  resolvedBy?: string | null;
  /** Why the change was discarded. Required when it carries calibration readings. */
  reason?: string | null;
};

const CONFLICT_SELECT = `
SELECT id, event_id, entity_type, entity_id, local_payload_json, remote_payload_json,
  conflict_type, status, created_at, resolved_at, resolved_by, resolution_reason,
  (
    SELECT group_concat(DISTINCT domain_events.event_type)
    FROM domain_events
    WHERE (
        (sync_conflicts.event_id IS NOT NULL AND domain_events.event_id = sync_conflicts.event_id)
        OR (
          sync_conflicts.event_id IS NULL
          AND domain_events.aggregate_id = sync_conflicts.entity_id
          AND domain_events.sync_state = 'conflict'
        )
      )
  ) AS event_types
FROM sync_conflicts`;

export function listSyncConflicts(
  database: LocalDatabase,
  input: ListSyncConflictsInput = {},
) {
  const status = input.status ?? "open";
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const rows = database
    .prepare<{ status: string; limit: number }, SyncConflictRow>(
      `
${CONFLICT_SELECT}
WHERE status = @status
ORDER BY created_at DESC
LIMIT @limit
`,
    )
    .all({ status, limit });

  const totalRow = database
    .prepare<{ status: string }, { total: number }>(
      `
SELECT COUNT(*) AS total
FROM sync_conflicts
WHERE status = @status
`,
    )
    .get({ status });

  return {
    data: rows.map(mapConflictRow),
    total: totalRow?.total ?? 0,
  };
}

/**
 * Decides a conflict.
 *
 * - `resolved`: keep the local change. It goes back to `pending` and is sent again (a job
 *   execution against the cloud version the user reviewed; any record against the version the
 *   cloud named, so the same write is not refused again for the very change they overrode).
 * - `discarded_by_user` (`ignored` is the old name of it): give the local change up. The queued
 *   event becomes `discarded`: kept for audit with who, when and why, and never sent. Older
 *   builds marked it `synced`, which hid a change the cloud never received. A change that
 *   carries calibration readings needs a reason (`SyncConflictReasonRequiredError`); the old
 *   name is exempt so an older web build keeps working.
 */
export function resolveSyncConflict(
  database: LocalDatabase,
  id: string,
  status: "resolved" | "discarded_by_user" | "ignored" = "resolved",
  options: ResolveSyncConflictOptions = {},
): LocalSyncConflict | null {
  const existing = getSyncConflict(database, id);
  if (!existing) return null;

  const discarding = status !== "resolved";
  const reason = options.reason?.trim() || null;
  if (status === "discarded_by_user" && reason === null && existing.regulated) {
    throw new SyncConflictReasonRequiredError();
  }
  const now = new Date().toISOString();

  database.transaction(() => {
    database
      .prepare(
        `
UPDATE sync_conflicts
SET status = @status,
  resolved_at = @resolvedAt,
  resolved_by = @resolvedBy,
  resolution_reason = @reason
WHERE id = @id
`,
      )
      .run({
        id,
        status: discarding ? "discarded_by_user" : "resolved",
        resolvedAt: now,
        resolvedBy: options.resolvedBy ?? null,
        reason,
      });

    if (!discarding) {
      moveConflictedEvents(database, existing.eventId, existing.entityId, {
        kind: "requeue",
      });
      // Keeping the local job execution: it is pushed again against the cloud
      // version the technician just reviewed (the conflict carries it), or the
      // cloud would refuse it again for the very change they decided to override.
      const reviewedAt = reviewedJobUpdatedAt(existing);
      if (reviewedAt !== null) {
        rebaseQueuedJobEvents(database, existing.entityId, reviewedAt);
      }
      // The same for the record's version: adopt the one the cloud named.
      const reviewedVersion = reviewedAggregateVersion(existing);
      if (reviewedVersion !== null) {
        recordAggregateVersion(
          database,
          existing.entityType,
          existing.entityId,
          reviewedVersion,
        );
      }
    } else {
      moveConflictedEvents(database, existing.eventId, existing.entityId, {
        kind: "discard",
        discardedBy: options.resolvedBy ?? null,
        reason,
        now,
      });
    }

    // Discarding keeps the cloud's version: if a pull skipped that row while
    // the local change was queued, it must be fetched again now.
    releaseSettledSkippedRows(database);
    // What waited for the conflicting event is released (or, once it is discarded, decided
    // one by one when the event was the creation of a record).
    recomputeBlockedOutbox(database);
  })();

  return getSyncConflict(database, id);
}

function reviewedAggregateVersion(conflict: LocalSyncConflict): number | null {
  const remote = conflict.remotePayload;
  if (!remote || typeof remote !== "object" || Array.isArray(remote)) {
    return null;
  }
  const version = Object.fromEntries(Object.entries(remote)).aggregateVersion;
  return typeof version === "number" &&
    Number.isInteger(version) &&
    version >= 0
    ? version
    : null;
}

function reviewedJobUpdatedAt(conflict: LocalSyncConflict): string | null {
  if (conflict.entityType !== "calibration_job") return null;
  const remote = conflict.remotePayload;
  if (!remote || typeof remote !== "object" || Array.isArray(remote)) {
    return null;
  }
  const updatedAt = Object.fromEntries(Object.entries(remote)).updatedAt;
  return typeof updatedAt === "string" && !Number.isNaN(Date.parse(updatedAt))
    ? updatedAt
    : null;
}

type ConflictedEventMove =
  | { kind: "requeue" }
  | {
      kind: "discard";
      discardedBy: string | null;
      reason: string | null;
      now: string;
    };

function moveConflictedEvents(
  database: LocalDatabase,
  eventId: string | null,
  entityId: string,
  move: ConflictedEventMove,
) {
  const selection = `
WHERE event_id IN (
  SELECT event_id
  FROM domain_events
  WHERE (
      (@eventId IS NOT NULL AND event_id = @eventId)
      OR (@eventId IS NULL AND aggregate_id = @entityId)
    )
    AND sync_state = 'conflict'
)`;

  if (move.kind === "requeue") {
    database
      .prepare(
        `
UPDATE outbox
SET status = 'pending',
  last_error = NULL,
  next_attempt_at = NULL
${selection}
`,
      )
      .run({ eventId, entityId });
  } else {
    database
      .prepare(
        `
UPDATE outbox
SET status = 'discarded',
  discarded_at = @now,
  discarded_by = @discardedBy,
  discard_reason = @reason,
  blocked_by_event_id = NULL,
  blocked_at = NULL,
  next_attempt_at = NULL
${selection}
`,
      )
      .run({
        eventId,
        entityId,
        now: move.now,
        discardedBy: move.discardedBy,
        reason: move.reason,
      });
  }

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
      eventSyncState: move.kind === "requeue" ? "pending" : "discarded",
    });
}

export function getSyncConflict(database: LocalDatabase, id: string) {
  const row = database
    .prepare<{ id: string }, SyncConflictRow>(
      `
${CONFLICT_SELECT}
WHERE id = @id
LIMIT 1
`,
    )
    .get({ id });

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
    resolvedBy: row.resolved_by,
    resolutionReason: row.resolution_reason,
    regulated: (row.event_types ?? "")
      .split(",")
      .some((operation) => isRegulatedOutboxOperation(operation)),
  });
}

function parseJson(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
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
  resolved_by: string | null;
  resolution_reason: string | null;
  event_types?: string | null;
};
