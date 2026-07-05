import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { applySyncPushResult, openLocalDatabase } from "./index";

// REL-01 slice 2 — REQ-REL-SYNC-204: a version-based ("concurrent_update")
// conflict returned by the server for ANY of the three newly-guarded event
// types (asset / customer / service-order execution) is recorded into the local
// `sync_conflicts` table by the SAME generic push-response handler the
// job-execution conflict already flows through — no per-entity mapping added.
//
// This proves the desktop-side recording is generic: applySyncPushResult
// iterates `response.conflicts` and inserts each one regardless of entityType /
// conflictType. If someone added a `switch (entityType)` that dropped the new
// types, this test would go RED.

const tempDirectories: string[] = [];

function createTempDatabasePath() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-local-db-"));
  tempDirectories.push(directory);
  return path.join(directory, "calibra.sqlite");
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

type StoredConflict = {
  event_id: string | null;
  entity_type: string;
  entity_id: string;
  local_payload_json: string;
  remote_payload_json: string;
  conflict_type: string;
  status: string;
};

function readConflict(
  database: ReturnType<typeof openLocalDatabase>,
  id: string,
): StoredConflict {
  const row = database
    .prepare<[string], StoredConflict>(
      `
SELECT event_id, entity_type, entity_id, local_payload_json,
       remote_payload_json, conflict_type, status
FROM sync_conflicts
WHERE id = ?
`,
    )
    .get(id);
  if (!row) throw new Error(`Expected sync_conflicts row ${id}`);
  return row;
}

describe("REQ-REL-SYNC-204 — generic desktop recording of slice-2 conflicts", () => {
  it("records concurrent_update conflicts for asset, customer, and execution events into sync_conflicts", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });

    const cases = [
      {
        id: "desktop-conflict:asset:local-asset-1:evt-asset",
        eventId: "evt-asset",
        entityType: "asset",
        entityId: "local-asset-1",
      },
      {
        id: "desktop-conflict:customer:local-customer-1:evt-customer",
        eventId: "evt-customer",
        entityType: "customer",
        entityId: "local-customer-1",
      },
      {
        id: "desktop-conflict:service_order_execution:local-exec-1:evt-exec",
        eventId: "evt-exec",
        entityType: "service_order_execution",
        entityId: "local-exec-1",
      },
    ];

    applySyncPushResult(database, {
      accepted: [],
      rejected: [],
      conflicts: cases.map((entry) => ({
        id: entry.id,
        eventId: entry.eventId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        conflictType: "concurrent_update",
        status: "open",
        localPayload: { name: "Edição desktop" },
        remotePayload: {
          entity: entry.entityType,
          id: 42,
          updatedAt: "2026-06-02T00:00:00.000Z",
          baseUpdatedAt: "2026-06-01T00:00:00.000Z",
        },
      })),
      newCursor: "cursor-204",
    });

    for (const entry of cases) {
      const stored = readConflict(database, entry.id);
      expect(stored.entity_type).toBe(entry.entityType);
      expect(stored.entity_id).toBe(entry.entityId);
      expect(stored.conflict_type).toBe("concurrent_update");
      expect(stored.status).toBe("open");
      expect(JSON.parse(stored.local_payload_json)).toEqual({
        name: "Edição desktop",
      });
      expect(JSON.parse(stored.remote_payload_json)).toEqual({
        entity: entry.entityType,
        id: 42,
        updatedAt: "2026-06-02T00:00:00.000Z",
        baseUpdatedAt: "2026-06-01T00:00:00.000Z",
      });
    }

    const count = database
      .prepare<[], { total: number }>(
        `SELECT COUNT(*) AS total FROM sync_conflicts WHERE status = 'open'`,
      )
      .get();
    expect(count?.total).toBe(3);

    database.close();
  });
});
