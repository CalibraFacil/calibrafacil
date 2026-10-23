/**
 * Cursor + page planning for `GET /api/sync/pull`.
 *
 * The pull reads several tables, each with its own `limit + 1` window, and
 * merges them into one event stream ordered by time. A single global cursor
 * can therefore only be advanced as far as the SLOWEST limited table got:
 * moving it to the newest timestamp across all tables (what the first
 * implementation did) skips, forever, every row that a limited table had not
 * yet returned but that is older than that timestamp.
 *
 * Design: a total order over the whole stream, `(timestamp, entityRank, id)`.
 *   - `timestamp` is the row's `updatedAt`/`publishedAt` truncated to
 *     milliseconds (the precision the wire format and JS `Date` carry), so a
 *     cursor round-trip is exact.
 *   - `entityRank` is the index in {@link SYNC_PULL_ENTITY_ORDER}; it
 *     tie-breaks rows of different tables that share a millisecond.
 *   - `id` (serial integer in every pulled table) tie-breaks rows of the same
 *     table, so a page boundary may fall between two rows with the same
 *     timestamp without losing or repeating either.
 * Each table is read `> cursor` in that order. When a table fills its window
 * (`limit + 1` rows came back) the page is cut at the smallest "last included
 * row" among the limited tables and every newer row of the other tables is
 * dropped from the page; the cursor is that boundary row. Nothing past the
 * cursor was ever sent, so nothing is skipped, and the page always contains
 * at least `limit` rows of the boundary table, so the cursor strictly
 * advances.
 *
 * Wire format: the cursor stays an opaque string. Deployed desktops send back
 * whatever they received, and still send the bare ISO timestamp they got from
 * the old server (or from bootstrap): that parses as "everything strictly
 * after this instant", i.e. exactly the old semantics.
 *
 * DEPRECATED (protocols 1 and 2). Desktops of protocol 3 pull a commit-ordered
 * change log instead (change-log.ts, docs/architecture/sync-change-seq.md), which
 * solves the hazard below. This module is kept, unchanged, for the desktops that
 * still send the `updatedAt` cursor, and is deleted once SYNC_MIN_DESKTOP_VERSION
 * excludes them (DEPLOYMENT.md).
 *
 * KNOWN HAZARD (solved by protocol 3, not here): ordering is by the row's own
 * `updatedAt`, which is assigned when the row is written, not when its
 * transaction commits. A transaction that stamped T1 but commits after a
 * reader already returned a row stamped T2 > T1 is invisible to every later
 * pull (clock skew between API instances produces the same effect). Replaying
 * an overlap window would hide it, but the desktop applies pulled rows with a
 * blind upsert that resets `sync_state` to 'synced', so a replay would
 * clobber a local edit that is still waiting in the outbox. The durable fix is
 * a server-side monotonic sequence (a bigserial/LSN-like column, bumped in
 * the same statement as the row) used as the cursor instead of the timestamp.
 */
import { type AnyColumn, type SQL, and, gte, or, sql } from "drizzle-orm";

export const SYNC_PULL_ENTITY_ORDER = [
  "asset_type",
  "customer",
  "asset",
  "service",
  "reference_standard",
  "environmental_limit",
  "calibration_job",
  "service_order",
  "published_method",
] as const;

export type SyncPullEntityType = (typeof SYNC_PULL_ENTITY_ORDER)[number];

export type SyncPullPosition = {
  /** Epoch milliseconds. */
  timestampMs: number;
  /** Index in {@link SYNC_PULL_ENTITY_ORDER}; `ORDER.length` = after every table. */
  rank: number;
  id: number;
};

const CURSOR_PREFIX = "v2|";
const AFTER_EVERY_TABLE_RANK = SYNC_PULL_ENTITY_ORDER.length;

export function syncPullRank(entityType: SyncPullEntityType) {
  return SYNC_PULL_ENTITY_ORDER.indexOf(entityType);
}

/**
 * Parse a cursor sent by a client. Accepts the new composite format and the
 * legacy bare ISO timestamp; anything unparseable (including the push cursors
 * older desktops store, `cursor:<batch>:<n>`) restarts from the epoch, as the
 * original implementation did.
 */
export function parseSyncPullPosition(
  cursor: string | null | undefined,
): SyncPullPosition {
  const epoch = {
    timestampMs: 0,
    rank: AFTER_EVERY_TABLE_RANK,
    id: 0,
  } satisfies SyncPullPosition;
  if (!cursor) return epoch;

  if (cursor.startsWith(CURSOR_PREFIX)) {
    const [iso, entityType, rawId] = cursor
      .slice(CURSOR_PREFIX.length)
      .split("|");
    const timestampMs = Date.parse(iso ?? "");
    const rank = SYNC_PULL_ENTITY_ORDER.findIndex(
      (name) => name === entityType,
    );
    const id = Number(rawId);
    if (
      Number.isNaN(timestampMs) ||
      rank < 0 ||
      !Number.isSafeInteger(id) ||
      id < 0
    ) {
      return epoch;
    }
    return { timestampMs, rank, id };
  }

  const legacyMs = Date.parse(cursor);
  if (Number.isNaN(legacyMs)) return epoch;
  return { timestampMs: legacyMs, rank: AFTER_EVERY_TABLE_RANK, id: 0 };
}

export function formatSyncPullPosition(position: SyncPullPosition) {
  const iso = new Date(position.timestampMs).toISOString();
  const entityType = SYNC_PULL_ENTITY_ORDER[position.rank];
  // A position past every table has no composite form: emit the legacy bare
  // timestamp, which parses back to the same position.
  if (entityType === undefined) return iso;
  return `${CURSOR_PREFIX}${iso}|${entityType}|${position.id}`;
}

/** Millisecond-truncated view of a timestamp column (see module comment). */
export function syncPullTimestamp(column: AnyColumn) {
  return sql`date_trunc('milliseconds', ${column})`;
}

/**
 * `WHERE` fragment selecting the rows of one table that sort strictly after
 * `position` in the global `(timestamp, rank, id)` order.
 */
export function afterSyncPullPosition(
  entityType: SyncPullEntityType,
  columns: { timestamp: AnyColumn; id: AnyColumn },
  position: SyncPullPosition,
): SQL {
  const rank = syncPullRank(entityType);
  const truncated = syncPullTimestamp(columns.timestamp);
  const boundary = sql`${new Date(position.timestampMs).toISOString()}::timestamp`;

  // The raw column comparison is a superset of the exact predicate below
  // (truncation only rounds down), so it lets Postgres use an index range scan.
  const coarse = gte(columns.timestamp, new Date(position.timestampMs));

  let exact: SQL;
  if (rank < position.rank) {
    exact = sql`${truncated} > ${boundary}`;
  } else if (rank > position.rank) {
    exact = sql`${truncated} >= ${boundary}`;
  } else {
    exact =
      or(
        sql`${truncated} > ${boundary}`,
        and(
          sql`${truncated} = ${boundary}`,
          sql`${columns.id} > ${position.id}`,
        ),
      ) ?? sql`false`;
  }

  return and(coarse, exact) ?? exact;
}

export type SyncPullWindow = {
  entityType: SyncPullEntityType;
  /**
   * Rows already ordered by `(timestamp, id)`, at most `limit + 1` of them:
   * the extra row only signals that the table has more.
   */
  rows: ReadonlyArray<{ timestampMs: number; id: number }>;
};

export type SyncPullPagePlan = {
  /** How many leading rows of each table (by entity type) belong to the page. */
  take: Map<SyncPullEntityType, number>;
  hasMore: boolean;
  /** Last position covered by the page; `null` when the page is empty. */
  last: SyncPullPosition | null;
};

/**
 * Decide which rows of each table are part of the page, given every table's
 * `limit + 1` window. See the module comment for the invariant.
 */
export function planSyncPullPage(
  windows: ReadonlyArray<SyncPullWindow>,
  limit: number,
): SyncPullPagePlan {
  let bound: SyncPullPosition | null = null;
  for (const window of windows) {
    if (window.rows.length <= limit) continue;
    const row = window.rows[limit - 1];
    if (!row) continue;
    const position = {
      timestampMs: row.timestampMs,
      rank: syncPullRank(window.entityType),
      id: row.id,
    } satisfies SyncPullPosition;
    if (bound === null || compareCoarse(position, bound) < 0) bound = position;
  }

  const take = new Map<SyncPullEntityType, number>();
  let last: SyncPullPosition | null = null;
  for (const window of windows) {
    const rank = syncPullRank(window.entityType);
    let count = 0;
    for (const row of window.rows) {
      if (count >= limit) break;
      if (bound !== null && !isAtOrBefore(row, rank, bound)) break;
      count += 1;
      const position = { timestampMs: row.timestampMs, rank, id: row.id };
      if (last === null || compareFull(position, last) > 0) last = position;
    }
    take.set(window.entityType, count);
  }

  return { take, hasMore: bound !== null, last };
}

/** Order by (timestamp, rank): enough to compare rows of different tables. */
function compareCoarse(left: SyncPullPosition, right: SyncPullPosition) {
  return left.timestampMs - right.timestampMs || left.rank - right.rank;
}

function compareFull(left: SyncPullPosition, right: SyncPullPosition) {
  return compareCoarse(left, right) || left.id - right.id;
}

function isAtOrBefore(
  row: { timestampMs: number; id: number },
  rank: number,
  bound: SyncPullPosition,
) {
  return (
    compareFull({ timestampMs: row.timestampMs, rank, id: row.id }, bound) <= 0
  );
}
