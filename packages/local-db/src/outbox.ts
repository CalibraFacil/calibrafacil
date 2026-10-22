import type { SyncPushResponse } from "@calibra-facil/contracts";
import {
  classifyOutboxRejection,
  isRegulatedOutboxOperation,
  stringifySyncConflictPayload,
} from "@calibra-facil/contracts";
import type { LocalDatabase } from "./database";
import { releaseSettledSkippedRows } from "./skipped-rows";
import {
  recomputeServiceOrderSyncStates,
  resolveServiceOrdersForAggregates,
} from "./service-orders";

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

const RECORDED_ACTOR_SQL = `(domain_events.actor_user_id IS NOT NULL
    AND domain_events.actor_user_id NOT IN ('', 'local'))`;

/**
 * An outbox event whose recorded author is not `actorUserId`. Events with no
 * recorded author (older rows, or the "local" placeholder) belong to nobody in
 * particular and are never counted. `null` (the signed-in user is not known)
 * counts nothing: there is no one to compare against.
 */
export function countPendingOutboxForOtherUsers(
  database: LocalDatabase,
  actorUserId: string | null,
) {
  if (actorUserId === null) return 0;

  const row = database
    .prepare<{ actorUserId: string }, { total: number }>(
      `
SELECT COUNT(*) AS total
FROM outbox
INNER JOIN domain_events ON domain_events.event_id = outbox.event_id
WHERE outbox.status IN ('pending', 'failed')
  AND ${RECORDED_ACTOR_SQL}
  AND domain_events.actor_user_id <> @actorUserId
`,
    )
    .get({ actorUserId });

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
  options: {
    includeDeferred?: boolean;
    /**
     * The signed-in user. When given, only events authored by them (or with no
     * recorded author) are returned: the cloud attributes a pushed event to the
     * session that pushes it, so another user's event must wait until that user
     * is signed in. It stays queued, untouched.
     */
    actorUserId?: string | null;
  } = {},
): PendingOutboxEvent[] {
  const now = new Date().toISOString();
  const rows = database
    .prepare<
      {
        now: string;
        limit: number;
        includeDeferred: number;
        actorUserId: string | null;
      },
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
    -- A job execution carries its base in the payload it was written with:
    -- there is one per queued event, and the accept of an earlier one moves it.
    WHEN 'calibration_job' THEN
      json_extract(domain_events.payload_json, '$.baseUpdatedAt')
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
  AND (
    @actorUserId IS NULL
    OR NOT ${RECORDED_ACTOR_SQL}
    OR domain_events.actor_user_id = @actorUserId
  )
ORDER BY
  CASE
    WHEN outbox.next_attempt_at IS NOT NULL AND outbox.next_attempt_at > @now
      THEN 1
    ELSE 0
  END ASC,
  outbox.created_at ASC
LIMIT @limit
`,
    )
    .all({
      now,
      limit,
      includeDeferred: options.includeDeferred ? 1 : 0,
      actorUserId: options.actorUserId ?? null,
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

/**
 * An event the cloud refused for good (see `@calibra-facil/contracts` outbox-rejections). It is not
 * pending: nothing selects it, and it waits for a person to discard or
 * re-queue it.
 */
export type DeadOutboxEvent = {
  eventId: string;
  entityType: string;
  entityId: string;
  operation: string;
  errorCode: string | null;
  errorMessage: string | null;
  attemptCount: number;
  occurredAt: string;
  deadAt: string | null;
  /** Carries calibration readings: discarding it leaves them only on this computer. */
  regulated: boolean;
};

/** Pending events that are waiting out a retry delay, so not due yet. */
export function countDeferredOutbox(database: LocalDatabase) {
  const row = database
    .prepare<{ now: string }, { total: number }>(
      `
SELECT COUNT(*) AS total
FROM outbox
WHERE status IN ('pending', 'failed')
  AND next_attempt_at IS NOT NULL
  AND next_attempt_at > @now
`,
    )
    .get({ now: new Date().toISOString() });

  return row?.total ?? 0;
}

export function countDeadOutbox(database: LocalDatabase) {
  const row = database
    .prepare<
      [],
      { total: number }
    >("SELECT COUNT(*) AS total FROM outbox WHERE status = 'dead'")
    .get();

  return row?.total ?? 0;
}

export function listDeadOutboxEvents(
  database: LocalDatabase,
  options: { limit?: number } = {},
): DeadOutboxEvent[] {
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));

  return database
    .prepare<{ limit: number }, DeadOutboxEventRow>(
      `${DEAD_OUTBOX_SELECT}
WHERE outbox.status = 'dead'
ORDER BY outbox.dead_at DESC, outbox.created_at DESC
LIMIT @limit`,
    )
    .all({ limit })
    .map(mapDeadOutboxEvent);
}

/**
 * Takes a dead event out of the queue for good. The row stays, as `discarded`
 * with its code, message and time, and the event stays in `domain_events`: that
 * is the local audit trace. Only a dead event can be discarded. The local data
 * the event described is not touched.
 */
export function discardDeadOutboxEvent(
  database: LocalDatabase,
  eventId: string,
): DeadOutboxEvent | null {
  const existing = database
    .prepare<{ eventId: string }, DeadOutboxEventRow>(
      `${DEAD_OUTBOX_SELECT}
WHERE outbox.status = 'dead' AND outbox.event_id = @eventId`,
    )
    .get({ eventId });
  if (!existing) return null;

  database.transaction(() => {
    database
      .prepare(
        `
UPDATE outbox
SET status = 'discarded',
  discarded_at = @now,
  next_attempt_at = NULL
WHERE event_id = @eventId AND status = 'dead'
`,
      )
      .run({ eventId, now: new Date().toISOString() });
    database
      .prepare(
        `
UPDATE domain_events
SET sync_state = 'discarded'
WHERE event_id = @eventId
`,
      )
      .run({ eventId });

    // Discarding gives up the local change: a pull that skipped the row while
    // the change was queued can bring the cloud's version in now.
    releaseSettledSkippedRows(database);
  })();

  return mapDeadOutboxEvent(existing);
}

/**
 * Sends a dead event through the queue again, for when whatever the cloud
 * refused it over has been fixed (a renewed standard, a granted competence).
 * Only a dead event can be re-queued; one refused again goes back to dead.
 */
export function requeueDeadOutboxEvent(
  database: LocalDatabase,
  eventId: string,
): boolean {
  let requeued = false;

  database.transaction(() => {
    const result = database
      .prepare(
        `
UPDATE outbox
SET status = 'pending',
  last_error = NULL,
  error_code = NULL,
  dead_at = NULL,
  next_attempt_at = NULL
WHERE event_id = @eventId AND status = 'dead'
`,
      )
      .run({ eventId });
    if (result.changes === 0) return;

    database
      .prepare(
        `
UPDATE domain_events
SET sync_state = 'pending'
WHERE event_id = @eventId
`,
      )
      .run({ eventId });
    requeued = true;
  })();

  return requeued;
}

const DEAD_OUTBOX_SELECT = `
SELECT
  outbox.event_id,
  outbox.attempt_count,
  outbox.last_error,
  outbox.error_code,
  outbox.dead_at,
  domain_events.aggregate_kind,
  domain_events.aggregate_id,
  domain_events.event_type,
  domain_events.occurred_at
FROM outbox
INNER JOIN domain_events ON domain_events.event_id = outbox.event_id`;

function mapDeadOutboxEvent(row: DeadOutboxEventRow): DeadOutboxEvent {
  const prefix = row.error_code === null ? null : `${row.error_code}: `;

  return {
    eventId: row.event_id,
    entityType: row.aggregate_kind,
    entityId: row.aggregate_id,
    operation: row.event_type,
    errorCode: row.error_code,
    errorMessage:
      row.last_error !== null &&
      prefix !== null &&
      row.last_error.startsWith(prefix)
        ? row.last_error.slice(prefix.length)
        : row.last_error,
    attemptCount: row.attempt_count,
    occurredAt: row.occurred_at,
    deadAt: row.dead_at,
    regulated: isRegulatedOutboxOperation(row.event_type),
  };
}

type DeadOutboxEventRow = {
  event_id: string;
  attempt_count: number;
  last_error: string | null;
  error_code: string | null;
  dead_at: string | null;
  aggregate_kind: string;
  aggregate_id: string;
  event_type: string;
  occurred_at: string;
};

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

    // Child acceptances leave the parent order dirty on their own; recompute
    // after every acceptance in this batch has landed, so an order with two
    // queued children is not cleared by the first of them. Batched, because
    // this runs on every push cycle while a backlog drains.
    recomputeServiceOrderSyncStates(
      database,
      resolveServiceOrdersForAggregates(
        database,
        acceptedAggregates(acceptedById, eventsById),
      ),
    );

    for (const [eventId, rejection] of rejectedById) {
      const attemptCount =
        database
          .prepare<
            { eventId: string },
            { attempt_count: number }
          >("SELECT attempt_count FROM outbox WHERE event_id = @eventId")
          .get({ eventId })?.attempt_count ?? 0;
      const lastError = `${rejection.code}: ${rejection.reason}`;

      if (classifyOutboxRejection(rejection.code) === "permanent") {
        // Never going to be accepted as it stands: park it where nothing
        // selects it, keeping the code and message for the person who decides.
        database
          .prepare(
            `
UPDATE outbox
SET status = 'dead',
  attempt_count = attempt_count + 1,
  last_error = @lastError,
  error_code = @errorCode,
  dead_at = @now,
  next_attempt_at = NULL
WHERE event_id = @eventId
`,
          )
          .run({ eventId, lastError, errorCode: rejection.code, now });
        database
          .prepare(
            `
UPDATE domain_events
SET sync_state = 'dead'
WHERE event_id = @eventId
`,
          )
          .run({ eventId });
        continue;
      }

      database
        .prepare(
          `
UPDATE outbox
SET status = 'failed',
  attempt_count = attempt_count + 1,
  last_error = @lastError,
  error_code = @errorCode,
  next_attempt_at = @nextAttemptAt
WHERE event_id = @eventId
`,
        )
        .run({
          eventId,
          lastError,
          errorCode: rejection.code,
          nextAttemptAt: new Date(
            Date.now() + getOutboxRetryDelayMs(attemptCount),
          ).toISOString(),
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

    // Accepted events have cleared their rows; a skipped pull row that is now
    // clean is fetched again (an accepted change normally comes back through
    // the pull anyway, this also covers one the cloud answered without changing).
    releaseSettledSkippedRows(database);

    // `response.newCursor` is deliberately not stored. It is the push batch's
    // marker (`cursor:<batch>:<n>`), not a position in the pull stream; saving
    // it as the pull cursor made the next pull restart from the epoch and
    // re-download (and re-apply) every row after each push. Only a pull or a
    // bootstrap moves the pull cursor.
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

/** The aggregates a batch of accepted events touched. */
function acceptedAggregates(
  acceptedById: Map<string, unknown>,
  eventsById: Map<string, DomainEventRow>,
): Array<{ kind: string; id: string }> {
  const aggregates: Array<{ kind: string; id: string }> = [];

  for (const eventId of acceptedById.keys()) {
    const event = eventsById.get(eventId);
    if (!event) continue;

    aggregates.push({ kind: event.aggregate_kind, id: event.aggregate_id });
  }

  return aggregates;
}

/**
 * Moves the base version of every execution still queued for a job (not yet
 * sent, or waiting for a review) to `baseUpdatedAt`: the cloud job's updatedAt
 * after an accepted write, or the version the technician reviewed in a
 * conflict they resolved by keeping the local execution.
 */
export function rebaseQueuedJobEvents(
  database: LocalDatabase,
  aggregateId: string,
  baseUpdatedAt: string,
) {
  database
    .prepare(
      `
UPDATE outbox
SET payload_json = json_set(payload_json, '$.baseUpdatedAt', @baseUpdatedAt)
WHERE event_id IN (
  SELECT event_id FROM domain_events
  WHERE aggregate_kind = 'calibration_job'
    AND aggregate_id = @aggregateId
    AND sync_state IN ('pending', 'failed', 'conflict')
)
`,
    )
    .run({ aggregateId, baseUpdatedAt });
  database
    .prepare(
      `
UPDATE domain_events
SET payload_json = json_set(payload_json, '$.baseUpdatedAt', @baseUpdatedAt)
WHERE aggregate_kind = 'calibration_job'
  AND aggregate_id = @aggregateId
  AND sync_state IN ('pending', 'failed', 'conflict')
`,
    )
    .run({ aggregateId, baseUpdatedAt });
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
    const remoteUpdatedAt = getString(remoteEntity, "updatedAt");
    database
      .prepare(
        `
UPDATE calibration_jobs
SET remote_id = @remoteId,
  job_id = COALESCE(@officialJobId, job_id),
  updated_at = COALESCE(@remoteUpdatedAt, updated_at),
  sync_state = 'synced'
WHERE id = @localId
`,
      )
      .run({
        remoteId: accepted.remoteEntityId,
        officialJobId,
        remoteUpdatedAt,
        localId: event.aggregate_id,
      });
    // REQ-SP-5: the cloud job's updatedAt moved with this accepted write. The
    // executions still queued for the job were made against the version before
    // it; left alone they would be refused as somebody else's change.
    if (remoteUpdatedAt !== null) {
      rebaseQueuedJobEvents(database, event.aggregate_id, remoteUpdatedAt);
    }
  }

  if (
    event.aggregate_kind === "asset" &&
    typeof accepted.remoteEntityId === "number"
  ) {
    // REL-01 slice 3 (REQ-REL-RES-002): refresh the base-version anchor to the
    // accepted server updatedAt. Without this a SECOND same-device edit before
    // the next pull is compared against the stale pre-push base and the server
    // reports a false self-conflict. COALESCE keeps the prior anchor when a
    // (legacy) accept response omits updatedAt.
    database
      .prepare(
        `
UPDATE assets
SET remote_id = @remoteId,
  sync_state = 'synced',
  remote_base_updated_at = COALESCE(@remoteBaseUpdatedAt, remote_base_updated_at)
WHERE id = @localId
`,
      )
      .run({
        remoteId: accepted.remoteEntityId,
        remoteBaseUpdatedAt: getString(
          asRecord(accepted.remoteEntity),
          "updatedAt",
        ),
        localId: event.aggregate_id,
      });
  }

  if (
    event.aggregate_kind === "customer" &&
    typeof accepted.remoteEntityId === "number"
  ) {
    // REL-01 slice 3 (REQ-REL-RES-002): refresh the base-version anchor on accept.
    database
      .prepare(
        `
UPDATE customers
SET remote_id = @remoteId,
  sync_state = 'synced',
  remote_base_updated_at = COALESCE(@remoteBaseUpdatedAt, remote_base_updated_at)
WHERE id = @localId
`,
      )
      .run({
        remoteId: accepted.remoteEntityId,
        remoteBaseUpdatedAt: getString(
          asRecord(accepted.remoteEntity),
          "updatedAt",
        ),
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
    // REL-01 slice 3 (REQ-REL-RES-002/003): the execution row has no pull path,
    // so the accept response is the ONLY place its base-version anchor gets set.
    // Write the accepted server updatedAt so slice-2 divergence detection can
    // fire on a genuinely stale second edit (and not on the device's own push).
    database
      .prepare(
        `
UPDATE service_order_executions
SET remote_id = @remoteId,
  sync_state = 'synced',
  remote_base_updated_at = COALESCE(@remoteBaseUpdatedAt, remote_base_updated_at)
WHERE id = @localId
`,
      )
      .run({
        remoteId: accepted.remoteEntityId,
        remoteBaseUpdatedAt: getString(remoteEntity, "updatedAt"),
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
    event.aggregate_kind === "non_conformance" &&
    typeof accepted.remoteEntityId === "number"
  ) {
    const remoteEntity = asRecord(accepted.remoteEntity);
    const officialNcNumber = getString(remoteEntity, "ncNumber");
    database
      .prepare(
        `
UPDATE non_conformances
SET remote_id = @remoteId,
  nc_number = COALESCE(@officialNcNumber, nc_number),
  sync_state = 'synced'
WHERE id = @localId
`,
      )
      .run({
        remoteId: accepted.remoteEntityId,
        officialNcNumber,
        localId: event.aggregate_id,
      });
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
