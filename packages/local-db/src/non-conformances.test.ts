import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  applySyncPushResult,
  createLocalNonConformance,
  listLocalNonConformances,
  listPendingOutboxEvents,
  openLocalDatabase,
} from "./index";

// Issue #426 Phase 0 — offline NC capture. Creating an NC on the desktop must
// enqueue a `non_conformance` / `create_local_non_conformance` outbox event
// whose payload matches the cloud `CreateNonConformanceSchema` (no `jobId`:
// job linking stays cloud-only), and an ACCEPT from the cloud ingest must stamp
// the remote id AND the official `nc_number` back onto the local row.

const tempDirectories: string[] = [];

function createTempDatabasePath() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-nc-"));
  tempDirectories.push(directory);
  return path.join(directory, "calibra.sqlite");
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const DETECTED_AT = "2026-07-01T12:00:00.000Z";

function createNc(database: ReturnType<typeof openLocalDatabase>) {
  return createLocalNonConformance(database, {
    organizationId: "org-1",
    unitId: 1,
    actorUserId: "user-1",
    deviceId: "device-1",
    type: "equipment",
    description: "Padrao de referencia apresentou deriva acima do limite",
    detectedAt: DETECTED_AT,
  });
}

describe("createLocalNonConformance", () => {
  it("inserts a provisional local row and enqueues the fixed sync-contract outbox event", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });

    const created = createNc(database);

    expect(created.ncNumber).toMatch(/^LOCAL-NC-\d{4}-0001$/);
    expect(created.status).toBe("open");
    expect(created.syncState).toBe("local");
    expect(created.detectedAt).toBe(DETECTED_AT);

    const event = listPendingOutboxEvents(database).find(
      (candidate) => candidate.entityType === "non_conformance",
    );
    if (!event) throw new Error("expected a pending non_conformance event");

    expect(event.operation).toBe("create_local_non_conformance");
    // Exact payload contract for the cloud ingest — notably NO jobId.
    expect(event.payload).toEqual({
      type: "equipment",
      description: "Padrao de referencia apresentou deriva acima do limite",
      detectedAt: DETECTED_AT,
    });

    database.close();
  });

  it("accept round-trip stamps remote_id and the official nc_number onto the local row", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });

    createNc(database);
    const event = listPendingOutboxEvents(database).find(
      (candidate) => candidate.entityType === "non_conformance",
    );
    if (!event) throw new Error("expected a pending non_conformance event");

    applySyncPushResult(database, {
      accepted: [
        {
          eventId: event.eventId,
          remoteEntityId: 4242,
          remoteEntity: { id: 4242, ncNumber: "NC-2026-0042" },
          remoteVersion: 1,
          cloudEventId: `cloud-${event.eventId}`,
        },
      ],
      rejected: [],
      conflicts: [],
      newCursor: "cursor-nc-accept",
    });

    const row = database
      .prepare<
        [string],
        { remote_id: number | null; nc_number: string; sync_state: string }
      >("SELECT remote_id, nc_number, sync_state FROM non_conformances WHERE id = ?")
      .get(event.entityId);

    expect(row?.remote_id).toBe(4242);
    expect(row?.nc_number).toBe("NC-2026-0042");
    expect(row?.sync_state).toBe("synced");

    const listed = listLocalNonConformances(database, { page: 1, limit: 20 });
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0]?.id).toBe(4242);
    expect(listed.data[0]?.ncNumber).toBe("NC-2026-0042");

    database.close();
  });
});
