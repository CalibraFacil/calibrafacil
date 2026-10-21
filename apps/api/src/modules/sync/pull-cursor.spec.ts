import { describe, expect, it } from "vitest";
import {
  SYNC_PULL_ENTITY_ORDER,
  formatSyncPullPosition,
  parseSyncPullPosition,
  planSyncPullPage,
  type SyncPullEntityType,
  type SyncPullWindow,
} from "./pull-cursor";

type Row = { timestampMs: number; id: number };

function window(entityType: SyncPullEntityType, rows: Row[]): SyncPullWindow {
  return { entityType, rows };
}

function rowsAt(timestampMs: number, ids: number[]): Row[] {
  return ids.map((id) => ({ timestampMs, id }));
}

/**
 * Drive the planner against in-memory tables the way the route does: read
 * `limit + 1` rows after the cursor per table, plan, advance.
 */
function pullAll(
  tables: Map<SyncPullEntityType, Row[]>,
  limit: number,
): Array<Array<`${SyncPullEntityType}:${number}`>> {
  let position = parseSyncPullPosition(null);
  const pages: Array<Array<`${SyncPullEntityType}:${number}`>> = [];

  for (let guard = 0; guard < 100; guard += 1) {
    const windows = SYNC_PULL_ENTITY_ORDER.map((entityType) => {
      const rank = SYNC_PULL_ENTITY_ORDER.indexOf(entityType);
      const rows = (tables.get(entityType) ?? [])
        .filter((row) => {
          if (rank < position.rank)
            return row.timestampMs > position.timestampMs;
          if (rank > position.rank)
            return row.timestampMs >= position.timestampMs;
          return (
            row.timestampMs > position.timestampMs ||
            (row.timestampMs === position.timestampMs && row.id > position.id)
          );
        })
        .sort((a, b) => a.timestampMs - b.timestampMs || a.id - b.id)
        .slice(0, limit + 1);
      return window(entityType, rows);
    });
    const plan = planSyncPullPage(windows, limit);
    pages.push(
      windows.flatMap((w) =>
        w.rows
          .slice(0, plan.take.get(w.entityType) ?? 0)
          .map((row) => `${w.entityType}:${row.id}` as const),
      ),
    );
    if (!plan.hasMore) return pages;
    if (plan.last === null) throw new Error("hasMore page with no rows");
    position = plan.last;
  }
  throw new Error("pull did not terminate");
}

describe("planSyncPullPage", () => {
  it("REQ-SYNC-PULL-005: cuts the page at the smallest boundary of the limited tables", () => {
    const plan = planSyncPullPage(
      [
        window("customer", rowsAt(1000, [1, 2, 3])),
        window("asset_type", rowsAt(5000, [9])),
      ],
      2,
    );

    expect(plan.hasMore).toBe(true);
    expect(plan.take.get("customer")).toBe(2);
    expect(plan.take.get("asset_type")).toBe(0);
    expect(plan.last).toEqual({
      timestampMs: 1000,
      rank: SYNC_PULL_ENTITY_ORDER.indexOf("customer"),
      id: 2,
    });
  });

  it("REQ-SYNC-PULL-006: returns every row and no hasMore when no table filled its window", () => {
    const plan = planSyncPullPage(
      [
        window("customer", rowsAt(1000, [1, 2])),
        window("asset_type", rowsAt(5000, [9])),
      ],
      2,
    );

    expect(plan.hasMore).toBe(false);
    expect(plan.take.get("customer")).toBe(2);
    expect(plan.take.get("asset_type")).toBe(1);
  });

  it("REQ-SYNC-PULL-007: pages through several tables without skipping or repeating any row", () => {
    const tables = new Map<SyncPullEntityType, Row[]>([
      ["customer", [...rowsAt(1000, [1, 2, 3, 4, 5]), ...rowsAt(2000, [6])]],
      ["asset", [...rowsAt(1000, [1, 2]), ...rowsAt(3000, [3, 4, 5])]],
      ["asset_type", rowsAt(9000, [1])],
      ["service_order", rowsAt(1000, [1, 2, 3])],
    ]);

    for (const limit of [1, 2, 3, 7, 100]) {
      const seen = pullAll(tables, limit).flat();
      const expected = [...tables].flatMap(([entityType, rows]) =>
        rows.map((row) => `${entityType}:${row.id}`),
      );
      expect([...seen].sort()).toEqual([...expected].sort());
      expect(new Set(seen).size).toBe(seen.length);
    }
  });
});

describe("sync pull cursor format", () => {
  it("REQ-SYNC-PULL-008: round-trips a composite position", () => {
    const position = {
      timestampMs: Date.parse("2026-03-04T05:06:07.089Z"),
      rank: SYNC_PULL_ENTITY_ORDER.indexOf("calibration_job"),
      id: 42,
    };

    expect(formatSyncPullPosition(position)).toBe(
      "v2|2026-03-04T05:06:07.089Z|calibration_job|42",
    );
    expect(parseSyncPullPosition(formatSyncPullPosition(position))).toEqual(
      position,
    );
  });

  it("REQ-SYNC-PULL-009: reads a legacy bare timestamp as strictly after that instant", () => {
    const legacy = parseSyncPullPosition("2026-03-04T05:06:07.089Z");

    expect(legacy.timestampMs).toBe(Date.parse("2026-03-04T05:06:07.089Z"));
    expect(legacy.rank).toBe(SYNC_PULL_ENTITY_ORDER.length);
    // ...and writes back as the same bare timestamp.
    expect(formatSyncPullPosition(legacy)).toBe("2026-03-04T05:06:07.089Z");
  });

  it("REQ-SYNC-PULL-010: restarts from the epoch for empty or unparseable cursors", () => {
    for (const cursor of [
      null,
      "",
      "cursor:batch-1:3",
      "v2|garbage|customer|1",
      "v2|2026-03-04T05:06:07.089Z|nope|1",
      "v2|2026-03-04T05:06:07.089Z|customer|-1",
    ]) {
      expect(parseSyncPullPosition(cursor).timestampMs).toBe(0);
    }
  });
});
