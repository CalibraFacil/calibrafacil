import {
  compareSyncChangePositions,
  formatSyncChangeCursor,
  parseSyncChangeCursor,
} from "@calibra-facil/contracts";
import type { LocalDatabase } from "./database";

/**
 * Rows a pull left alone because they had queued local changes (see
 * `applySyncBootstrap`), and what to do once those changes are settled.
 *
 * The pull cursor moves past a skipped row. If its queued change is later
 * accepted, the cloud row changes and comes back through the normal pull. But a
 * change can also settle WITHOUT being accepted: a conflict the user resolves
 * as "ignore" keeps the cloud's version, so the local row must take it, yet the
 * cloud row never changes again. Nothing would re-send it, and the desktop would
 * keep the discarded local state indefinitely. So skipped rows are recorded, and
 * when one is clean again the pull cursor is rewound to just before the cloud
 * version that was passed over; the next pull brings it back (every pull
 * endpoint already returns everything after a cursor, so no new endpoint is
 * needed, and rows that still have queued changes are skipped again).
 *
 * Protocol 3 pulls the change log by position, not by time: a skipped row then
 * remembers the cursor that returns its change again (`resume_cursor`, which the
 * pull event carries) and the cursor is rewound to the oldest of them. A row skipped
 * by a bootstrap page has no log position (NULL): the rewind starts over, which the
 * cloud answers with "bootstrap again". Always correct, never cheap, and rare (a
 * conflict ignored in favour of the cloud, on a row a bootstrap met with queued edits).
 */

export type SkippedRowKind =
  | "customer"
  | "asset"
  | "calibration_job"
  | "service_order";

const KIND_TABLES: Record<SkippedRowKind, string> = {
  customer: "customers",
  asset: "assets",
  calibration_job: "calibration_jobs",
  service_order: "service_orders",
};

export function recordSkippedRow(
  database: LocalDatabase,
  row: {
    entityType: SkippedRowKind;
    localId: string;
    remoteId: number;
    /** The cloud version that was passed over. */
    cloudUpdatedAt: string | null;
    /** Protocol 3: the pull cursor that returns the passed-over change again. */
    resumeCursor?: string | null;
  },
  skippedAt = new Date().toISOString(),
) {
  const existing = database
    .prepare<
      { entityType: string; localId: string },
      { resume_cursor: string | null }
    >("SELECT resume_cursor FROM sync_skipped_rows WHERE entity_type = @entityType AND local_id = @localId")
    .get({ entityType: row.entityType, localId: row.localId });
  // Keep the OLDEST position for the same reason as the oldest version below.
  const resumeCursor =
    existing === undefined
      ? (row.resumeCursor ?? null)
      : olderResumeCursor(existing.resume_cursor, row.resumeCursor ?? null);

  // Keep the OLDEST passed-over version: rewinding to it also re-fetches any
  // later one.
  database
    .prepare(
      `
INSERT INTO sync_skipped_rows (
  entity_type, local_id, remote_id, cloud_updated_at, skipped_at, resume_cursor
) VALUES (
  @entityType, @localId, @remoteId, @cloudUpdatedAt, @skippedAt, @resumeCursor
)
ON CONFLICT(entity_type, local_id) DO UPDATE SET
  resume_cursor = excluded.resume_cursor,
  cloud_updated_at = CASE
    WHEN sync_skipped_rows.cloud_updated_at IS NULL
      OR excluded.cloud_updated_at IS NULL THEN NULL
    WHEN excluded.cloud_updated_at < sync_skipped_rows.cloud_updated_at
      THEN excluded.cloud_updated_at
    ELSE sync_skipped_rows.cloud_updated_at
  END
`,
    )
    .run({
      entityType: row.entityType,
      localId: row.localId,
      remoteId: row.remoteId,
      cloudUpdatedAt: row.cloudUpdatedAt,
      skippedAt,
      resumeCursor,
    });
}

/**
 * The earlier of two resume cursors. Unknown (NULL, or not a log position) on either
 * side stays unknown: starting over covers anything.
 */
function olderResumeCursor(left: string | null, right: string | null) {
  if (left === null || right === null) return null;
  const a = parseSyncChangeCursor(left);
  const b = parseSyncChangeCursor(right);
  if (a.kind !== "position" || b.kind !== "position") return null;
  return compareSyncChangePositions(a.position, b.position) <= 0 ? left : right;
}

export function countSkippedRows(database: LocalDatabase) {
  return (
    database
      .prepare<
        [],
        { total: number }
      >("SELECT COUNT(*) AS total FROM sync_skipped_rows")
      .get()?.total ?? 0
  );
}

type SkippedRow = {
  entity_type: SkippedRowKind;
  local_id: string;
  remote_id: number;
  cloud_updated_at: string | null;
  resume_cursor: string | null;
};

/**
 * Forget the skipped rows whose queued changes are all settled and rewind the
 * pull cursor to re-fetch them. Returns how many were released. Safe to call
 * any time (after a push result, after a conflict is resolved, before a pull).
 */
export function releaseSettledSkippedRows(database: LocalDatabase): number {
  const rows = database
    .prepare<
      [],
      SkippedRow
    >("SELECT entity_type, local_id, remote_id, cloud_updated_at, resume_cursor FROM sync_skipped_rows")
    .all();
  const settled = rows.filter((row) => !hasUnsettledChanges(database, row));
  if (settled.length === 0) return 0;

  database.transaction(() => {
    for (const row of settled) {
      database
        .prepare(
          "DELETE FROM sync_skipped_rows WHERE entity_type = ? AND local_id = ?",
        )
        .run(row.entity_type, row.local_id);
    }
    rewindPullCursor(database, settled);
  })();

  return settled.length;
}

function hasUnsettledChanges(database: LocalDatabase, row: SkippedRow) {
  const table = KIND_TABLES[row.entity_type];
  // A locally created row keeps its own id and only gains the remote id, so the
  // queued events may be addressed to either.
  const found = database
    .prepare<{ kind: string; localId: string; remoteId: number }, { one: 1 }>(
      `
SELECT 1 AS one
FROM outbox o
JOIN domain_events e ON e.event_id = o.event_id
WHERE o.status NOT IN ('synced', 'discarded')
  AND e.aggregate_kind = @kind
  AND (
    e.aggregate_id = @localId
    OR e.aggregate_id IN (SELECT id FROM ${table} WHERE remote_id = @remoteId)
  )
LIMIT 1
`,
    )
    .get({
      kind: row.entity_type,
      localId: row.local_id,
      remoteId: row.remote_id,
    });

  return found !== undefined;
}

function rewindPullCursor(database: LocalDatabase, settled: SkippedRow[]) {
  const current = database
    .prepare<
      [],
      { cursor: string | null }
    >("SELECT cursor FROM sync_cursors WHERE scope = 'default'")
    .get();
  // No cursor yet: the next pull starts from the beginning anyway.
  if (!current || current.cursor === null) return;

  const position = parseSyncChangeCursor(current.cursor);
  if (position.kind === "position") {
    rewindChangeLogCursor(database, position.position, settled);
    return;
  }

  const cloudUpdatedAts = settled.map((row) => row.cloud_updated_at);

  const times = cloudUpdatedAts.map((value) =>
    value === null ? Number.NaN : Date.parse(value),
  );
  // One version of unknown age: start over, which is always correct.
  const target = times.some(Number.isNaN)
    ? null
    : // The cursor is "strictly after": step back so the passed-over version
      // itself is returned.
      new Date(Math.min(...times) - 1).toISOString();

  if (target !== null) {
    const currentMs = cursorTimestampMs(current.cursor);
    if (currentMs !== null && currentMs <= Date.parse(target)) return;
  }

  database
    .prepare("UPDATE sync_cursors SET cursor = @cursor WHERE scope = 'default'")
    .run({ cursor: target });
}

/** Protocol 3: back to the oldest log position a settled row skipped; unknown means start over. */
function rewindChangeLogCursor(
  database: LocalDatabase,
  current: { xid: bigint; seq: bigint },
  settled: SkippedRow[],
) {
  const targets = settled.map((row) =>
    row.resume_cursor === null
      ? null
      : parseSyncChangeCursor(row.resume_cursor),
  );
  let target: string | null = null;
  const positions: Array<{ xid: bigint; seq: bigint }> = [];
  for (const parsed of targets) {
    if (parsed === null || parsed.kind !== "position") {
      positions.length = 0;
      break;
    }
    positions.push(parsed.position);
  }
  if (positions.length > 0) {
    const oldest = positions.reduce((left, right) =>
      compareSyncChangePositions(left, right) <= 0 ? left : right,
    );
    // Already at or before it: nothing to rewind.
    if (compareSyncChangePositions(current, oldest) <= 0) return;
    target = formatSyncChangeCursor(oldest);
  }

  database
    .prepare("UPDATE sync_cursors SET cursor = @cursor WHERE scope = 'default'")
    .run({ cursor: target });
}

/**
 * The instant a pull cursor stands at: the composite `v2|<iso>|…` the server
 * hands out, or a bare ISO timestamp. null for anything else (unknown).
 */
function cursorTimestampMs(cursor: string): number | null {
  const iso = cursor.startsWith("v2|") ? cursor.split("|")[1] : cursor;
  const ms = Date.parse(iso ?? "");
  return Number.isNaN(ms) ? null : ms;
}
