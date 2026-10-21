import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type {
  CloudSyncEvent,
  SyncBootstrapResponse,
} from "@calibra-facil/contracts";
import {
  applySyncBootstrap,
  applySyncPullResponse,
  applySyncPushResult,
  countSkippedRows,
  getSyncCursor,
  listPendingOutboxEvents,
  markOutboxEventsFailedForRetry,
  openLocalDatabase,
  releaseSettledSkippedRows,
  resolveSyncConflict,
  saveLocalJobExecution,
  setSyncCursor,
  saveLocalServiceOrderExecutionNotes,
  updateLocalAsset,
  updateLocalCustomer,
} from "./index";

// A pull must not overwrite a row that still has queued local changes. The
// upserts were blind and forced `sync_state = 'synced'`, so a pull that landed
// while an edit was waiting in the outbox silently replaced the edit.

const tempDirectories: string[] = [];

function createTempDatabasePath() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-pull-guard-"));
  tempDirectories.push(directory);
  return path.join(directory, "calibra.sqlite");
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

type Database = ReturnType<typeof openLocalDatabase>;

const BASE_UPDATED_AT = "2026-01-15T10:05:00.000Z";
const NEWER_CLOUD_UPDATED_AT = "2026-01-16T08:00:00.000Z";
const PULLED_AT = "2026-01-15T11:00:00.000Z";
const SECOND_PULL_AT = "2026-01-16T09:00:00.000Z";

function buildBootstrap(
  overrides: Partial<SyncBootstrapResponse>,
): SyncBootstrapResponse {
  return {
    serverTime: "2026-01-15T10:00:00.000Z",
    user: { id: "user-1", name: "User One", email: "user@example.com" },
    organization: { id: "org-1", type: "LAB" },
    activeUnits: [{ id: 1, name: "Matriz", role: "technician" }],
    permissions: {
      role: "technician",
      unitRole: "technician",
      activeUnitId: 1,
      accessibleUnitIds: [1],
      canAccessAllUnits: false,
    },
    featureFlags: {
      offlineApprovals: false,
      offlineCertificatePublication: false,
    },
    syncCursor: "2026-01-15T10:00:00.000Z",
    publishedMethods: [],
    assetTypes: [],
    customers: [],
    assets: [],
    services: [],
    standards: [],
    massCompositionProfiles: [],
    environmentalLimits: [],
    jobs: [],
    serviceOrders: [],
    ...overrides,
  };
}

function customerRow(name: string, updatedAt: string) {
  return {
    id: 123,
    name,
    taxId: "12345678000199",
    email: "pull@example.com",
    phone: null,
    address: null,
    compliance: null,
    updatedAt,
  };
}

function assetRow(name: string, updatedAt: string) {
  return {
    id: 456,
    customerId: 123,
    assetTypeId: 10,
    name,
    serialNumber: "SN-456",
    tag: "TAG-456",
    status: "ACTIVE",
    updatedAt,
  };
}

function jobRow(status: string, updatedAt: string) {
  return {
    id: 789,
    jobId: "J-789",
    customerId: 123,
    assetId: 456,
    serviceId: 5,
    unitId: 1,
    status,
    data: { reading: 1 },
    createdAt: BASE_UPDATED_AT,
    updatedAt,
  };
}

function serviceOrderRow(status: string, updatedAt: string) {
  return {
    id: 987,
    serviceOrderNumber: "OS-2026-0007",
    customerId: 123,
    assetId: 456,
    unitId: 1,
    status,
    priority: "normal",
    claimedDefect: "Nao liga",
    intakeCondition: "Sem danos",
    updatedAt,
  };
}

function pull(database: Database, rows: Partial<SyncBootstrapResponse>) {
  applySyncBootstrap(database, buildBootstrap(rows), PULLED_AT);
}

function upsert(
  entityType: CloudSyncEvent["entityType"],
  entityId: number,
  payload: unknown,
): CloudSyncEvent {
  return {
    cloudEventId: `cloud:${entityType}:${entityId}`,
    entityType,
    entityId,
    operation: "upsert",
    occurredAt: NEWER_CLOUD_UPDATED_AT,
    payload,
  };
}

function readRow(database: Database, table: string, id: string) {
  const row = database
    .prepare<
      [string],
      Record<string, unknown>
    >(`SELECT * FROM ${table} WHERE id = ?`)
    .get(id);
  if (!row) throw new Error(`Expected ${table} row ${id}`);
  return row;
}

/**
 * A cloud that answers pulls the way the real one does: everything stamped
 * strictly after the cursor (composite `v2|<iso>|…` or a bare ISO timestamp),
 * and a new cursor at the newest row returned.
 */
class FakeCloud {
  private rows = new Map<
    string,
    {
      entityType: CloudSyncEvent["entityType"];
      id: number;
      updatedAt: string;
      operation: "upsert" | "delete";
      payload: Record<string, unknown>;
    }
  >();

  set(
    entityType: CloudSyncEvent["entityType"],
    id: number,
    payload: Record<string, unknown> & { updatedAt: string },
  ) {
    this.rows.set(`${entityType}:${id}`, {
      entityType,
      id,
      updatedAt: payload.updatedAt,
      operation: "upsert",
      payload,
    });
  }

  delete(
    entityType: CloudSyncEvent["entityType"],
    id: number,
    deletedAt: string,
  ) {
    this.rows.set(`${entityType}:${id}`, {
      entityType,
      id,
      updatedAt: deletedAt,
      operation: "delete",
      payload: { id, updatedAt: deletedAt, deletedAt },
    });
  }

  pull(cursor: string | null) {
    const iso = cursor?.startsWith("v2|") ? cursor.split("|")[1] : cursor;
    const afterMs = iso ? Date.parse(iso) : 0;
    const events = [...this.rows.values()]
      .filter((row) => Date.parse(row.updatedAt) > afterMs)
      .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
      .map(
        (row): CloudSyncEvent => ({
          cloudEventId: `cloud:${row.entityType}:${row.id}:${row.updatedAt}`,
          entityType: row.entityType,
          entityId: row.id,
          operation: row.operation,
          occurredAt: row.updatedAt,
          payload: row.payload,
        }),
      );
    const last = events.at(-1);

    return {
      cursor: last
        ? `v2|${last.occurredAt}|${last.entityType}|${last.entityId}`
        : cursor,
      hasMore: false,
      events,
    };
  }
}

function pendingEvent(database: Database, entityType: string) {
  const event = listPendingOutboxEvents(database, 50, {
    includeDeferred: true,
  }).find((candidate) => candidate.entityType === entityType);
  if (!event) throw new Error(`Expected a queued ${entityType} event`);
  return event;
}

function accept(database: Database, eventId: string, remoteEntityId: number) {
  applySyncPushResult(database, {
    accepted: [
      {
        eventId,
        remoteEntityId,
        remoteEntity: { id: remoteEntityId, updatedAt: NEWER_CLOUD_UPDATED_AT },
        remoteVersion: 1,
        cloudEventId: `cloud-${eventId}`,
      },
    ],
    rejected: [],
    conflicts: [],
  });
}

describe("pull does not clobber queued local changes", () => {
  it("keeps a customer edit that is still in the outbox, with its base anchor", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    pull(database, { customers: [customerRow("Cloud v1", BASE_UPDATED_AT)] });
    updateLocalCustomer(database, {
      identifier: "customer:123",
      name: "Edited offline",
      actorUserId: "user-1",
      deviceId: "device-1",
    });

    const summary = applySyncPullResponse(
      database,
      {
        cursor: "cursor-2",
        hasMore: false,
        events: [
          upsert(
            "customer",
            123,
            customerRow("Cloud v2", NEWER_CLOUD_UPDATED_AT),
          ),
        ],
      },
      SECOND_PULL_AT,
    );

    const row = readRow(database, "customers", "customer:123");
    expect(row.name).toBe("Edited offline");
    expect(row.sync_state).toBe("local");
    // The queued edit must still be pushed against the version it was made on,
    // so the cloud can answer concurrent_update instead of a silent overwrite.
    expect(row.remote_base_updated_at).toBe(BASE_UPDATED_AT);
    expect(pendingEvent(database, "customer").baseUpdatedAt).toBe(
      BASE_UPDATED_AT,
    );
    expect(summary.skipped).toEqual([
      { entityType: "customer", localId: "customer:123" },
    ]);

    database.close();
  });

  describe("a skipped row comes back once its queued change is settled", () => {
    function pullFromCursor(database: Database, cloud: FakeCloud) {
      const cursor = getSyncCursor(database);
      const response = cloud.pull(cursor);
      return {
        cursorSent: cursor,
        summary: applySyncPullResponse(database, response, SECOND_PULL_AT),
      };
    }

    function ignoreConflictFor(database: Database, entityType: string) {
      const event = pendingEvent(database, entityType);
      applySyncPushResult(database, {
        accepted: [],
        rejected: [],
        conflicts: [
          {
            id: "conflict-1",
            eventId: event.eventId,
            entityType,
            entityId: event.entityId,
            conflictType: "concurrent_update",
            status: "open",
          },
        ],
      });
      resolveSyncConflict(database, "conflict-1", "ignored");
    }

    it("takes the cloud version after the conflict is ignored (keep cloud)", () => {
      const database = openLocalDatabase({
        filePath: createTempDatabasePath(),
      });
      pull(database, {
        customers: [customerRow("Cloud v1", BASE_UPDATED_AT)],
      });
      updateLocalCustomer(database, {
        identifier: "customer:123",
        name: "Edited offline",
        actorUserId: "user-1",
        deviceId: "device-1",
      });
      const cloud = new FakeCloud();
      cloud.set(
        "customer",
        123,
        customerRow("Cloud v2", NEWER_CLOUD_UPDATED_AT),
      );

      // A real pull: the row is skipped and the cursor moves past it.
      const first = pullFromCursor(database, cloud);
      expect(first.summary.skipped).toEqual([
        { entityType: "customer", localId: "customer:123" },
      ]);
      expect(readRow(database, "customers", "customer:123").name).toBe(
        "Edited offline",
      );
      expect(Date.parse(String(getSyncCursor(database)?.split("|")[1]))).toBe(
        Date.parse(NEWER_CLOUD_UPDATED_AT),
      );
      expect(countSkippedRows(database)).toBe(1);

      // Still queued: nothing is re-fetched yet.
      expect(releaseSettledSkippedRows(database)).toBe(0);

      ignoreConflictFor(database, "customer");

      // The cursor is back in front of the version that was passed over...
      expect(countSkippedRows(database)).toBe(0);
      expect(Date.parse(String(getSyncCursor(database)))).toBe(
        Date.parse(NEWER_CLOUD_UPDATED_AT) - 1,
      );
      // ...so the next pull, from the cursor actually stored, returns it.
      const second = pullFromCursor(database, cloud);
      expect(second.summary.skipped).toEqual([]);
      const row = readRow(database, "customers", "customer:123");
      expect(row.name).toBe("Cloud v2");
      expect(row.sync_state).toBe("synced");
      expect(row.remote_base_updated_at).toBe(NEWER_CLOUD_UPDATED_AT);

      database.close();
    });

    it("takes the cloud row after the queued edit is accepted", () => {
      const database = openLocalDatabase({
        filePath: createTempDatabasePath(),
      });
      pull(database, {
        customers: [customerRow("Cloud v1", BASE_UPDATED_AT)],
      });
      updateLocalCustomer(database, {
        identifier: "customer:123",
        name: "Edited offline",
        actorUserId: "user-1",
        deviceId: "device-1",
      });
      const cloud = new FakeCloud();
      cloud.set(
        "customer",
        123,
        customerRow("Cloud v2", NEWER_CLOUD_UPDATED_AT),
      );
      pullFromCursor(database, cloud);

      // The cloud takes the edit (and stamps the row again).
      cloud.set(
        "customer",
        123,
        customerRow("Edited offline", "2026-01-17T00:00:00.000Z"),
      );
      accept(database, pendingEvent(database, "customer").eventId, 123);
      pullFromCursor(database, cloud);

      const row = readRow(database, "customers", "customer:123");
      expect(row.name).toBe("Edited offline");
      expect(row.sync_state).toBe("synced");
      expect(row.remote_base_updated_at).toBe("2026-01-17T00:00:00.000Z");

      database.close();
    });

    it("applies a cloud deletion that was held back by a queued edit", () => {
      const database = openLocalDatabase({
        filePath: createTempDatabasePath(),
      });
      pull(database, {
        customers: [customerRow("Cloud v1", BASE_UPDATED_AT)],
        assets: [assetRow("Cloud asset", BASE_UPDATED_AT)],
      });
      updateLocalAsset(database, {
        identifier: "asset:456",
        name: "Edited asset",
        actorUserId: "user-1",
        deviceId: "device-1",
      });
      const cloud = new FakeCloud();
      cloud.delete("asset", 456, "2026-01-17T09:00:00.000Z");

      const first = pullFromCursor(database, cloud);
      expect(first.summary.skipped).toEqual([
        { entityType: "asset", localId: "asset:456" },
      ]);
      expect(readRow(database, "assets", "asset:456").deleted_at).toBeNull();

      ignoreConflictFor(database, "asset");
      pullFromCursor(database, cloud);

      expect(readRow(database, "assets", "asset:456").deleted_at).toBe(
        "2026-01-17T09:00:00.000Z",
      );
      expect(countSkippedRows(database)).toBe(0);

      database.close();
    });

    it("does not move a cursor that is already further back", () => {
      const database = openLocalDatabase({
        filePath: createTempDatabasePath(),
      });
      pull(database, {
        customers: [customerRow("Cloud v1", BASE_UPDATED_AT)],
      });
      updateLocalCustomer(database, {
        identifier: "customer:123",
        name: "Edited offline",
        actorUserId: "user-1",
        deviceId: "device-1",
      });
      const cloud = new FakeCloud();
      cloud.set(
        "customer",
        123,
        customerRow("Cloud v2", NEWER_CLOUD_UPDATED_AT),
      );
      pullFromCursor(database, cloud);
      // A paged pull is still working through older rows.
      setSyncCursor(database, "2026-01-10T00:00:00.000Z");

      ignoreConflictFor(database, "customer");

      expect(getSyncCursor(database)).toBe("2026-01-10T00:00:00.000Z");

      database.close();
    });
  });

  it("still overwrites a row that has nothing queued", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    pull(database, { customers: [customerRow("Cloud v1", BASE_UPDATED_AT)] });

    const summary = applySyncPullResponse(
      database,
      {
        cursor: "cursor-2",
        hasMore: false,
        events: [
          upsert(
            "customer",
            123,
            customerRow("Cloud v2", NEWER_CLOUD_UPDATED_AT),
          ),
        ],
      },
      SECOND_PULL_AT,
    );

    expect(readRow(database, "customers", "customer:123").name).toBe(
      "Cloud v2",
    );
    expect(summary.skipped).toEqual([]);

    database.close();
  });

  it("protects an edit whose push failed and is waiting for a retry", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    pull(database, {
      customers: [customerRow("Cloud v1", BASE_UPDATED_AT)],
      assets: [assetRow("Cloud asset v1", BASE_UPDATED_AT)],
    });
    updateLocalAsset(database, {
      identifier: "asset:456",
      name: "Edited asset",
      actorUserId: "user-1",
      deviceId: "device-1",
    });
    markOutboxEventsFailedForRetry(
      database,
      [pendingEvent(database, "asset").eventId],
      "offline",
    );

    applySyncBootstrap(
      database,
      buildBootstrap({
        customers: [customerRow("Cloud v1", BASE_UPDATED_AT)],
        assets: [assetRow("Cloud asset v2", NEWER_CLOUD_UPDATED_AT)],
      }),
      SECOND_PULL_AT,
    );

    const row = readRow(database, "assets", "asset:456");
    expect(row.name).toBe("Edited asset");
    expect(row.sync_state).toBe("local");
    expect(row.remote_base_updated_at).toBe(BASE_UPDATED_AT);

    database.close();
  });

  it("protects an edit that is waiting in a conflict", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    pull(database, {
      customers: [customerRow("Cloud v1", BASE_UPDATED_AT)],
      assets: [assetRow("Cloud asset v1", BASE_UPDATED_AT)],
    });
    updateLocalAsset(database, {
      identifier: "asset:456",
      name: "Edited asset",
      actorUserId: "user-1",
      deviceId: "device-1",
    });
    const event = pendingEvent(database, "asset");
    applySyncPushResult(database, {
      accepted: [],
      rejected: [],
      conflicts: [
        {
          id: "conflict-1",
          eventId: event.eventId,
          entityType: "asset",
          entityId: "asset:456",
          conflictType: "concurrent_update",
          status: "open",
        },
      ],
    });

    applySyncBootstrap(
      database,
      buildBootstrap({
        customers: [customerRow("Cloud v1", BASE_UPDATED_AT)],
        assets: [assetRow("Cloud asset v2", NEWER_CLOUD_UPDATED_AT)],
      }),
      SECOND_PULL_AT,
    );

    expect(readRow(database, "assets", "asset:456").name).toBe("Edited asset");

    database.close();
  });

  it("keeps a job execution that has not been pushed yet", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    pull(database, { jobs: [jobRow("DRAFT", BASE_UPDATED_AT)] });
    saveLocalJobExecution(database, {
      routeId: "789",
      actorUserId: "user-1",
      deviceId: "device-1",
      data: { reading: 42 },
    });

    applySyncPullResponse(
      database,
      {
        cursor: "cursor-2",
        hasMore: false,
        events: [
          upsert("calibration_job", 789, {
            ...jobRow("DRAFT", NEWER_CLOUD_UPDATED_AT),
            data: { reading: 1 },
          }),
        ],
      },
      SECOND_PULL_AT,
    );

    const row = readRow(database, "calibration_jobs", "job:789");
    expect(JSON.parse(String(row.data_json))).toEqual({ reading: 42 });
    expect(row.status).toBe("IN_PROGRESS");
    expect(row.sync_state).toBe("local");

    database.close();
  });

  it("refreshes an order header but keeps it dirty while a child event is queued", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    pull(database, {
      serviceOrders: [
        serviceOrderRow("awaiting_tech_evaluation", BASE_UPDATED_AT),
      ],
    });
    saveLocalServiceOrderExecutionNotes(database, {
      routeId: "987",
      actorUserId: "user-1",
      deviceId: "device-1",
      servicePerformed: "Diagnostico",
    });
    expect(
      readRow(database, "service_orders", "service-order:987").sync_state,
    ).toBe("local");

    const summary = applySyncPullResponse(
      database,
      {
        cursor: "cursor-2",
        hasMore: false,
        events: [
          upsert(
            "service_order",
            987,
            serviceOrderRow("in_progress", NEWER_CLOUD_UPDATED_AT),
          ),
        ],
      },
      SECOND_PULL_AT,
    );

    const row = readRow(database, "service_orders", "service-order:987");
    expect(row.status).toBe("in_progress");
    expect(row.sync_state).toBe("local");
    expect(summary.skipped).toEqual([]);

    database.close();
  });
});

describe("push result and the pull cursor", () => {
  it("does not store the push cursor as the pull cursor", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    pull(database, { customers: [customerRow("Cloud v1", BASE_UPDATED_AT)] });
    const pullCursor = getSyncCursor(database);
    expect(pullCursor).toBe("2026-01-15T10:00:00.000Z");

    updateLocalCustomer(database, {
      identifier: "customer:123",
      name: "Edited offline",
      actorUserId: "user-1",
      deviceId: "device-1",
    });
    applySyncPushResult(database, {
      accepted: [
        {
          eventId: pendingEvent(database, "customer").eventId,
          remoteEntityId: 123,
          remoteVersion: 1,
          cloudEventId: "cloud-1",
        },
      ],
      rejected: [],
      conflicts: [],
      newCursor: "cursor:batch-1:1",
    });

    expect(getSyncCursor(database)).toBe(pullCursor);

    database.close();
  });
});

describe("cloud deletions in the pull", () => {
  const DELETED_AT = "2026-01-17T09:00:00.000Z";

  function deleteEvent(
    entityType: CloudSyncEvent["entityType"],
    entityId: number,
    payload: Record<string, unknown>,
  ): CloudSyncEvent {
    return {
      cloudEventId: `cloud:${entityType}:${entityId}:delete`,
      entityType,
      entityId,
      operation: "delete",
      occurredAt: DELETED_AT,
      payload: { id: entityId, deletedAt: DELETED_AT, ...payload },
    };
  }

  function standardRow(updatedAt: string) {
    return {
      id: 55,
      name: "Padrao 55",
      serialNumber: "STD-55",
      certificateNumber: "CERT-55",
      nextCalibrationDate: "2027-01-01T00:00:00.000Z",
      status: "ACTIVE",
      updatedAt,
    };
  }

  it("soft-deletes an asset the cloud deleted", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    pull(database, {
      customers: [customerRow("Cloud v1", BASE_UPDATED_AT)],
      assets: [assetRow("Cloud asset", BASE_UPDATED_AT)],
    });

    applySyncPullResponse(
      database,
      {
        cursor: "cursor-2",
        hasMore: false,
        events: [deleteEvent("asset", 456, { updatedAt: DELETED_AT })],
      },
      SECOND_PULL_AT,
    );

    const row = readRow(database, "assets", "asset:456");
    expect(row.deleted_at).toBe(DELETED_AT);
    expect(row.sync_state).toBe("synced");
    expect(getSyncCursor(database)).toBe("cursor-2");

    database.close();
  });

  it("marks a standard the cloud deleted as deleted, which the local lists hide", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    pull(database, { standards: [standardRow(BASE_UPDATED_AT)] });

    applySyncPullResponse(
      database,
      {
        cursor: "cursor-2",
        hasMore: false,
        events: [deleteEvent("reference_standard", 55, {})],
      },
      SECOND_PULL_AT,
    );

    expect(
      readRow(database, "reference_standards", "standard:55").sync_state,
    ).toBe("deleted");

    database.close();
  });

  it("ignores a deletion of a row the desktop never had", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    pull(database, { customers: [customerRow("Cloud v1", BASE_UPDATED_AT)] });

    const summary = applySyncPullResponse(
      database,
      {
        cursor: "cursor-2",
        hasMore: false,
        events: [deleteEvent("asset", 999, {})],
      },
      SECOND_PULL_AT,
    );

    expect(summary.skipped).toEqual([]);
    expect(getSyncCursor(database)).toBe("cursor-2");

    database.close();
  });

  it("does not delete an asset that has a queued local edit", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    pull(database, {
      customers: [customerRow("Cloud v1", BASE_UPDATED_AT)],
      assets: [assetRow("Cloud asset", BASE_UPDATED_AT)],
    });
    updateLocalAsset(database, {
      identifier: "asset:456",
      name: "Edited asset",
      actorUserId: "user-1",
      deviceId: "device-1",
    });

    const summary = applySyncPullResponse(
      database,
      {
        cursor: "cursor-2",
        hasMore: false,
        events: [deleteEvent("asset", 456, {})],
      },
      SECOND_PULL_AT,
    );

    const row = readRow(database, "assets", "asset:456");
    expect(row.deleted_at).toBeNull();
    expect(row.name).toBe("Edited asset");
    expect(summary.skipped).toEqual([
      { entityType: "asset", localId: "asset:456" },
    ]);

    database.close();
  });
});
