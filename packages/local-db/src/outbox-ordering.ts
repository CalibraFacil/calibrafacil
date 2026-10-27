import type { LocalBlockedOutboxEvent } from "@calibra-facil/contracts";
import { isRegulatedOutboxOperation } from "@calibra-facil/contracts";
import type { LocalDatabase } from "./database";
import { stableLocalNumericId } from "./ids";

/**
 * Ordering and dependency rules of the outbox (roadmap 2 E1).
 *
 * - Order. Events are pushed by `domain_events.sequence` (a monotonic counter of this
 *   database, not the device clock), and a record's events leave strictly in that order:
 *   a later event of a record is never selected while an earlier one of the same record is
 *   not sendable (backing off, waiting for another user, blocked, in conflict, dead). The
 *   selection itself is in `outbox.ts`.
 * - Expected version. Each event carries the version of its record the cloud must be at
 *   (`expectedVersion`), so a stale write is a conflict and never a silent overwrite.
 * - Blocking. An event the cloud refused for good (`dead`) or that is in conflict needs a
 *   person. What depends on it must not be sent meanwhile, and must not be retried forever
 *   either: it is marked `blocked_by_event_id` and stays out of the selection until the
 *   blocker is resolved. Dependents are the later events of the same record and, when the
 *   blocker is the creation of a record, every event of a record that refers to it (the
 *   attachments of a record, a service order's customer and instrument, the notes of an
 *   order).
 */

export type AggregateRef = { kind: string; id: string };

function aggregateKey(kind: string, id: string) {
  return `${kind}\u0000${id}`;
}

// ---------------------------------------------------------------------------
// Aggregate versions (what the cloud confirmed)
// ---------------------------------------------------------------------------

/** The version the cloud last confirmed for a record, or null when it never did. */
export function getStoredAggregateVersion(
  database: LocalDatabase,
  kind: string,
  id: string,
): number | null {
  const row = database
    .prepare<
      { kind: string; id: string },
      { remote_version: number }
    >("SELECT remote_version FROM sync_aggregate_versions WHERE aggregate_kind = @kind AND aggregate_id = @id")
    .get({ kind, id });

  return row?.remote_version ?? null;
}

/** Records the version the cloud confirmed (an accepted event) or that a reviewed conflict names. */
export function recordAggregateVersion(
  database: LocalDatabase,
  kind: string,
  id: string,
  version: number,
) {
  database
    .prepare(
      `
INSERT INTO sync_aggregate_versions (aggregate_kind, aggregate_id, remote_version, updated_at)
VALUES (@kind, @id, @version, @now)
ON CONFLICT(aggregate_kind, aggregate_id) DO UPDATE SET
  remote_version = excluded.remote_version,
  updated_at = excluded.updated_at
`,
    )
    .run({ kind, id, version, now: new Date().toISOString() });
}

/**
 * The version a record is expected to be at before its first event of a batch is applied.
 *
 * - The cloud confirmed one: that.
 * - A record created on this computer whose creation the cloud never received: 0 (the cloud
 *   must not know it yet; a second device cannot have written to an id it never saw).
 * - Anything else (a row this desktop only pulled, or one synced before versions existed):
 *   null, no expectation. The cloud then compares `baseUpdatedAt` alone, as it always did.
 */
export function baseExpectedVersion(
  database: LocalDatabase,
  kind: string,
  id: string,
  firstOperation: string,
): number | null {
  const stored = getStoredAggregateVersion(database, kind, id);
  if (stored !== null) return stored;
  if (!firstOperation.startsWith("create_local_")) return null;

  const synced = database
    .prepare<{ kind: string; id: string }, { found: number }>(
      `
SELECT 1 AS found
FROM outbox
INNER JOIN domain_events ON domain_events.event_id = outbox.event_id
WHERE domain_events.aggregate_kind = @kind
  AND domain_events.aggregate_id = @id
  AND outbox.status = 'synced'
LIMIT 1
`,
    )
    .get({ kind, id });

  return synced ? null : 0;
}

// ---------------------------------------------------------------------------
// Dependents
// ---------------------------------------------------------------------------

/** Payload keys that name another record, and the kind of record they name. */
const PARENT_REFERENCE_KEYS: ReadonlyArray<readonly [string, string]> = [
  ["customerId", "customer"],
  ["assetId", "asset"],
  ["serviceOrderId", "service_order"],
  ["sourceServiceOrderId", "service_order"],
];

type UnsettledRow = {
  event_id: string;
  sequence: number;
  aggregate_kind: string;
  aggregate_id: string;
  event_type: string;
  status: string;
  blocked_by_event_id: string | null;
  payload_json: string | null;
};

/**
 * The records an event refers to. A reference is either a local id (a string equal to a
 * record's `aggregate_id`: an attachment's target, a service order's id) or a number (a
 * customer or instrument id as the payload carries it: the cloud id of a synced row, or the
 * stable number derived from a local id). Only records that still have queued events can
 * block anything, so only those are resolved.
 */
function referencedAggregates(
  row: UnsettledRow,
  byLocalId: Map<string, string[]>,
  byNumber: Map<string, string[]>,
): string[] {
  if (row.payload_json === null) return [];
  const payload = parseObject(row.payload_json);
  if (payload === null) return [];

  const found = new Set<string>();
  for (const [key, kind] of PARENT_REFERENCE_KEYS) {
    const value = payload[key];
    if (typeof value === "number") {
      for (const hit of byNumber.get(`${kind}:${value}`) ?? []) found.add(hit);
    } else if (typeof value === "string") {
      found.add(aggregateKey(kind, value));
      for (const hit of byLocalId.get(`${kind}:${value}`) ?? []) found.add(hit);
    }
  }
  const targetKind = payload.entityType;
  const targetId = payload.entityId;
  if (typeof targetKind === "string" && typeof targetId === "string") {
    found.add(aggregateKey(targetKind, targetId));
  }
  found.delete(aggregateKey(row.aggregate_kind, row.aggregate_id));

  return [...found];
}

function parseObject(json: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(Object.entries(parsed));
    }
  } catch {
    // An unreadable payload refers to nothing.
  }
  return null;
}

/**
 * Marks every queued event that depends on an event needing a person as blocked by it, and
 * releases the ones whose blocker was resolved. Idempotent; cheap (it reads the outbox rows
 * that are not finished). Run before every push and after every decision.
 *
 * Blockers: `dead` and `conflict` events, and a `discarded` event that was the creation of a
 * record the cloud never received (the record's dependents can never be applied, so they wait
 * for the user to decide about each one instead of failing for ever).
 */
export function recomputeBlockedOutbox(database: LocalDatabase): number {
  const rows = database
    .prepare<[], UnsettledRow>(
      `
SELECT
  outbox.event_id,
  domain_events.sequence,
  domain_events.aggregate_kind,
  domain_events.aggregate_id,
  domain_events.event_type,
  outbox.status,
  outbox.blocked_by_event_id,
  CASE WHEN outbox.status IN ('pending', 'failed')
    THEN domain_events.payload_json END AS payload_json
FROM outbox
INNER JOIN domain_events ON domain_events.event_id = outbox.event_id
WHERE outbox.status IN ('pending', 'failed', 'conflict', 'dead')
  OR (outbox.status = 'discarded' AND domain_events.event_type LIKE 'create_local_%')
ORDER BY domain_events.sequence ASC
`,
    )
    .all();

  const syncedAggregate = database.prepare<
    { kind: string; id: string },
    { found: number }
  >(`
SELECT 1 AS found
FROM outbox
INNER JOIN domain_events ON domain_events.event_id = outbox.event_id
WHERE domain_events.aggregate_kind = @kind
  AND domain_events.aggregate_id = @id
  AND outbox.status = 'synced'
LIMIT 1
`);

  const roots = rows.filter(
    (row) =>
      row.status === "dead" ||
      row.status === "conflict" ||
      (row.status === "discarded" &&
        !syncedAggregate.get({
          kind: row.aggregate_kind,
          id: row.aggregate_id,
        })),
  );
  const waiting = rows.filter(
    (row) => row.status === "pending" || row.status === "failed",
  );

  // Look-ups for numeric references: the records that have queued events.
  const byLocalId = new Map<string, string[]>();
  const byNumber = new Map<string, string[]>();
  const remember = (map: Map<string, string[]>, key: string, value: string) => {
    const list = map.get(key);
    if (list) {
      if (!list.includes(value)) list.push(value);
    } else {
      map.set(key, [value]);
    }
  };
  for (const row of rows) {
    const aggregate = aggregateKey(row.aggregate_kind, row.aggregate_id);
    remember(
      byNumber,
      `${row.aggregate_kind}:${stableLocalNumericId(row.aggregate_id)}`,
      aggregate,
    );
    const remote = /^[a-z_]+:(\d+)$/.exec(row.aggregate_id);
    if (remote?.[1]) {
      remember(byNumber, `${row.aggregate_kind}:${remote[1]}`, aggregate);
    }
    remember(byLocalId, `${row.aggregate_kind}:${row.aggregate_id}`, aggregate);
  }
  const references = new Map<string, string[]>(
    waiting.map((row) => [
      row.event_id,
      referencedAggregates(row, byLocalId, byNumber),
    ]),
  );

  const blockedBy = new Map<string, string>();
  for (const root of roots) {
    // Records whose events (from this sequence on) wait for the root, and records the cloud
    // will not have while it is unresolved (a creation that was refused or is in conflict).
    const heldFrom = new Map<string, number>([
      [aggregateKey(root.aggregate_kind, root.aggregate_id), root.sequence],
    ]);
    const missing = new Set<string>();
    if (root.event_type.startsWith("create_local_")) {
      missing.add(aggregateKey(root.aggregate_kind, root.aggregate_id));
    }

    let grew = true;
    while (grew) {
      grew = false;
      for (const row of waiting) {
        if (blockedBy.has(row.event_id)) continue;
        const key = aggregateKey(row.aggregate_kind, row.aggregate_id);
        const from = heldFrom.get(key);
        const behindRoot = from !== undefined && row.sequence > from;
        const needsMissing = (references.get(row.event_id) ?? []).some(
          (parent) => missing.has(parent),
        );
        if (!behindRoot && !needsMissing) continue;

        blockedBy.set(row.event_id, root.event_id);
        grew = true;
        if (from === undefined || row.sequence < from) {
          heldFrom.set(key, row.sequence);
        }
        if (row.event_type.startsWith("create_local_")) missing.add(key);
      }
    }
  }

  const now = new Date().toISOString();
  const update = database.prepare(
    `
UPDATE outbox
SET blocked_by_event_id = @blockedBy,
  blocked_at = CASE WHEN @blockedBy IS NULL THEN NULL ELSE COALESCE(blocked_at, @now) END
WHERE event_id = @eventId
`,
  );
  let changed = 0;
  database.transaction(() => {
    for (const row of waiting) {
      const next = blockedBy.get(row.event_id) ?? null;
      if (next === row.blocked_by_event_id) continue;
      update.run({ eventId: row.event_id, blockedBy: next, now });
      changed += 1;
    }
    // A decided event no longer waits for anything.
    database
      .prepare(
        `
UPDATE outbox
SET blocked_by_event_id = NULL, blocked_at = NULL
WHERE blocked_by_event_id IS NOT NULL
  AND status NOT IN ('pending', 'failed')
`,
      )
      .run();
  })();

  return changed;
}

export function countBlockedOutbox(database: LocalDatabase) {
  const row = database
    .prepare<
      [],
      { total: number }
    >("SELECT COUNT(*) AS total FROM outbox WHERE status IN ('pending', 'failed') AND blocked_by_event_id IS NOT NULL")
    .get();

  return row?.total ?? 0;
}

type BlockedRow = {
  event_id: string;
  aggregate_kind: string;
  aggregate_id: string;
  event_type: string;
  occurred_at: string;
  blocked_by_event_id: string;
  blocker_operation: string | null;
  blocker_entity_type: string | null;
  blocker_error_code: string | null;
  blocker_status: string | null;
};

/** The queued events that wait for another one, oldest first. */
export function listBlockedOutboxEvents(
  database: LocalDatabase,
  options: { limit?: number } = {},
): LocalBlockedOutboxEvent[] {
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));

  return database
    .prepare<{ limit: number }, BlockedRow>(
      `
SELECT
  outbox.event_id,
  domain_events.aggregate_kind,
  domain_events.aggregate_id,
  domain_events.event_type,
  domain_events.occurred_at,
  outbox.blocked_by_event_id,
  blocker_event.event_type AS blocker_operation,
  blocker_event.aggregate_kind AS blocker_entity_type,
  blocker.error_code AS blocker_error_code,
  blocker.status AS blocker_status
FROM outbox
INNER JOIN domain_events ON domain_events.event_id = outbox.event_id
LEFT JOIN outbox AS blocker ON blocker.event_id = outbox.blocked_by_event_id
LEFT JOIN domain_events AS blocker_event
  ON blocker_event.event_id = outbox.blocked_by_event_id
WHERE outbox.status IN ('pending', 'failed')
  AND outbox.blocked_by_event_id IS NOT NULL
ORDER BY domain_events.sequence ASC
LIMIT @limit
`,
    )
    .all({ limit })
    .map((row) => ({
      eventId: row.event_id,
      entityType: row.aggregate_kind,
      entityId: row.aggregate_id,
      operation: row.event_type,
      occurredAt: row.occurred_at,
      blockedByEventId: row.blocked_by_event_id,
      blockedByOperation: row.blocker_operation,
      blockedByEntityType: row.blocker_entity_type,
      blockedByErrorCode: row.blocker_error_code,
      blockedByStatus: row.blocker_status,
      regulated: isRegulatedOutboxOperation(row.event_type),
    }));
}
