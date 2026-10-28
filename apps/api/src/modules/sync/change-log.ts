/**
 * The commit-ordered pull (protocol 3): what `GET /api/sync/pull?protocolVersion=3`
 * answers. docs/architecture/sync-change-seq.md has the design and the argument for
 * why it cannot skip a row; the short version:
 *
 *   - Triggers append to `sync_change_log` in the writer's own transaction, stamping the
 *     entry with that transaction's id (`xid`, xid8).
 *   - A page is read in ONE statement: the entries after the cursor, in `(xid, seq)`
 *     order, whose `xid` is below `pg_snapshot_xmin(pg_current_snapshot())`: the oldest
 *     transaction id still in flight. Every transaction below it has finished, so every
 *     entry it will ever write is already visible: nothing can appear later behind the
 *     cursor. A transaction at or above it is not served yet (not even a committed one,
 *     it could sit behind an in-flight neighbour).
 *   - When the page reaches the end of what is servable the cursor becomes `(xmin, 0)`:
 *     everything below `xmin` is covered, including the entries the desktop's unit scope
 *     filtered out, so a narrow scope does not rescan them on every pull.
 *   - The log only says WHICH rows to look at again. The event carries the row as it is
 *     NOW (one event per row however many times it changed), or a delete when the row is
 *     gone, soft-deleted, or no longer in the desktop's scope (another unit, no longer
 *     published).
 */
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import {
  organization,
  syncChangeLog,
  syncChangeLogPurge,
} from "@calibra-facil/db/schema";
import {
  SYNC_CHANGE_ENTITY_ORDER,
  type SyncChangeEntityType,
} from "@calibra-facil/db/sync-change-log";
import {
  type CloudSyncEvent,
  type SyncChangePosition,
  type SyncResyncRequiredResponse,
  compareSyncChangePositions,
  formatSyncChangeCursor,
  parseSyncChangeCursor,
  syncChangeCursorBefore,
} from "@calibra-facil/contracts";
import type { OrgDb } from "@calibra-facil/db/for-org";
import { orgDb } from "../../lib/org-db";
import { buildUnitScopeCondition } from "../../lib/units";
import {
  type SyncScope,
  syncEntitySource,
  syncScopeFingerprint,
} from "./entity-sources";

export type ChangeLogPull =
  | {
      kind: "page";
      cursor: string;
      hasMore: boolean;
      events: CloudSyncEvent[];
    }
  | { kind: "resync"; reason: SyncResyncRequiredResponse["reason"] };

type LogEntry = {
  position: SyncChangePosition;
  entityType: SyncChangeEntityType;
  entityId: number;
  changedAt: Date;
};

const ENTITY_TYPES = new Set<string>(SYNC_CHANGE_ENTITY_ORDER);

function isEntityType(value: string): value is SyncChangeEntityType {
  return ENTITY_TYPES.has(value);
}

export async function pullChangeLog(input: {
  scope: SyncScope;
  cursor: string | null | undefined;
  limit: number;
}): Promise<ChangeLogPull> {
  const parsed = parseSyncChangeCursor(input.cursor);
  if (parsed.kind === "absent") return { kind: "resync", reason: "no_cursor" };
  if (parsed.kind === "foreign") {
    return { kind: "resync", reason: "cursor_format" };
  }
  const fingerprint = syncScopeFingerprint(input.scope);
  if (parsed.scope !== undefined && parsed.scope !== fingerprint) {
    return { kind: "resync", reason: "scope_changed" };
  }
  const since = parsed.position;
  // One transaction that names the laboratory (row-level security), READ
  // COMMITTED as before: every statement still takes its own snapshot, and the
  // in-flight horizon below is read in the same statement as the entries it
  // filters, so the cursor argument of docs/architecture/sync-change-seq.md is
  // unchanged. A read-only transaction has no transaction id, so it is never
  // the "oldest in flight" the horizon names.
  return orgDb(input.scope.organizationId).transaction((o) =>
    pullChangeLogIn(o, input.scope, since, input.limit),
  );
}

async function pullChangeLogIn(
  o: OrgDb,
  scope: SyncScope,
  since: SyncChangePosition,
  limit: number,
): Promise<ChangeLogPull> {
  const fingerprint = syncScopeFingerprint(scope);
  // A cursor below what the retention purge removed may have missed entries.
  const [purged] = await o
    .select({
      xid: syncChangeLogPurge.purgedThroughXid,
      seq: syncChangeLogPurge.purgedThroughSeq,
    })
    .from(syncChangeLogPurge);
  if (
    purged &&
    compareSyncChangePositions(since, {
      xid: BigInt(purged.xid),
      seq: purged.seq,
    }) < 0
  ) {
    return { kind: "resync", reason: "cursor_purged" };
  }

  // One statement: the entries and the in-flight horizon they are filtered by share a
  // snapshot. The organization row (a global table) is the left side so the horizon
  // comes back even when there are no entries.
  const rows = await o
    .select({
      horizon: sql<string>`pg_snapshot_xmin(pg_current_snapshot())::text`,
      seq: syncChangeLog.seq,
      xid: syncChangeLog.xid,
      entityType: syncChangeLog.entityType,
      entityId: syncChangeLog.entityId,
      changedAt: syncChangeLog.changedAt,
    })
    .from(organization)
    .leftJoin(
      syncChangeLog,
      and(
        eq(syncChangeLog.organizationId, organization.id),
        sql`(${syncChangeLog.xid}, ${syncChangeLog.seq}) > (${since.xid.toString()}::xid8, ${since.seq.toString()}::bigint)`,
        sql`${syncChangeLog.xid} < pg_snapshot_xmin(pg_current_snapshot())`,
        or(
          isNull(syncChangeLog.unitId),
          buildUnitScopeCondition(syncChangeLog.unitId, scope),
        ),
      ),
    )
    .where(eq(organization.id, scope.organizationId))
    .orderBy(asc(syncChangeLog.xid), asc(syncChangeLog.seq))
    .limit(limit + 1);

  const horizonText = rows[0]?.horizon;
  if (horizonText === undefined) {
    // Not even the organization row: nothing to serve, nothing to advance.
    return {
      kind: "page",
      cursor: formatSyncChangeCursor(since, fingerprint),
      hasMore: false,
      events: [],
    };
  }
  const horizon: SyncChangePosition = { xid: BigInt(horizonText), seq: 0n };

  const entries: LogEntry[] = rows.flatMap((row) =>
    row.seq === null ||
    row.xid === null ||
    row.entityType === null ||
    row.entityId === null ||
    row.changedAt === null ||
    !isEntityType(row.entityType)
      ? []
      : [
          {
            position: { xid: BigInt(row.xid), seq: row.seq },
            entityType: row.entityType,
            entityId: row.entityId,
            changedAt: row.changedAt,
          },
        ],
  );
  const hasMore = entries.length > limit;
  const page = entries.slice(0, limit);

  const events = await resolveEvents(o, scope, page);

  const last = page.at(-1);
  let next: SyncChangePosition;
  if (hasMore && last) {
    next = last.position;
  } else {
    // The end of what is servable: everything below the horizon is covered.
    next = compareSyncChangePositions(horizon, since) > 0 ? horizon : since;
  }
  return {
    kind: "page",
    cursor: formatSyncChangeCursor(next, fingerprint),
    hasMore,
    events,
  };
}

/**
 * One event per row named by the page, in the order its first entry appears: the row
 * as it is now, or a delete (gone, soft-deleted, out of scope).
 */
async function resolveEvents(
  o: OrgDb,
  scope: SyncScope,
  page: readonly LogEntry[],
): Promise<CloudSyncEvent[]> {
  // The first entry of each entity in the page: the cursor that returns it again.
  const first = new Map<string, LogEntry>();
  const idsByType = new Map<SyncChangeEntityType, number[]>();
  for (const entry of page) {
    const key = `${entry.entityType}:${entry.entityId}`;
    if (first.has(key)) continue;
    first.set(key, entry);
    const ids = idsByType.get(entry.entityType) ?? [];
    ids.push(entry.entityId);
    idsByType.set(entry.entityType, ids);
  }

  const events: CloudSyncEvent[] = [];
  for (const [entityType, ids] of idsByType) {
    const found = new Map(
      (await syncEntitySource(entityType).byIds(o, scope, ids)).map((row) => [
        row.id,
        row,
      ]),
    );
    for (const id of ids) {
      const entry = first.get(`${entityType}:${id}`);
      if (!entry) continue;
      const row = found.get(id);
      const occurredAt = (row?.changedAt ?? entry.changedAt).toISOString();
      events.push({
        cloudEventId: `cloud:${entityType}:${id}:${occurredAt}`,
        entityType,
        entityId: id,
        // A row that is gone, soft-deleted or no longer in this desktop's scope is a
        // tombstone; a soft-deleted row keeps its payload (`deletedAt`).
        operation: row && !row.deleted ? "upsert" : "delete",
        occurredAt,
        payload: row ? row.payload : { id },
        resumeCursor: syncChangeCursorBefore(entry.position),
      });
    }
  }

  const order = (event: CloudSyncEvent) => {
    const entry = first.get(`${event.entityType}:${event.entityId}`);
    return entry ? entry.position : { xid: 0n, seq: 0n };
  };
  return [...events].sort((left, right) =>
    compareSyncChangePositions(order(left), order(right)),
  );
}
