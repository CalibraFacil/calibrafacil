import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type {
  CloudSyncEvent,
  SyncBootstrapPageResponse,
  SyncBootstrapResponse,
} from "@calibra-facil/contracts";
import {
  applySyncBootstrap,
  applySyncBootstrapPage,
  applySyncPullResponse,
  applySyncPushResult,
  countSkippedRows,
  discardBootstrapProgress,
  getBootstrapPageToken,
  getSyncCursor,
  hasIncompleteBootstrap,
  listPendingOutboxEvents,
  openLocalDatabase,
  releaseSettledSkippedRows,
  resolveSyncConflict,
  setSyncCursor,
  updateLocalCustomer,
} from "./index";

// Protocol 3 on the desktop: the paged bootstrap (REQ-CS-3), delete events for every
// mirrored entity (REQ-CS-2), and the change-log cursor (REQ-CS-1/5).

const tempDirectories: string[] = [];

function createTempDatabasePath() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-change-seq-"));
  tempDirectories.push(directory);
  return path.join(directory, "calibra.sqlite");
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

type Database = ReturnType<typeof openLocalDatabase>;

const PULLED_AT = "2026-01-15T11:00:00.000Z";
const SECOND_PULL_AT = "2026-01-16T09:00:00.000Z";
const BASE_UPDATED_AT = "2026-01-15T10:05:00.000Z";
const NEWER_UPDATED_AT = "2026-01-16T08:00:00.000Z";

const HEADER = {
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
};

function bootstrap(
  rows: Partial<SyncBootstrapResponse>,
  syncCursor = "v3|50|0",
): SyncBootstrapResponse {
  return {
    ...HEADER,
    syncCursor,
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
    ...rows,
  };
}

function page(
  rows: Partial<SyncBootstrapResponse>,
  nextToken: string | null,
  syncCursor = "v3|50|0",
): SyncBootstrapPageResponse {
  const rowCount = Object.values(rows).reduce(
    (total, value) => total + (Array.isArray(value) ? value.length : 0),
    0,
  );
  return {
    ...bootstrap(rows, syncCursor),
    syncCursor,
    page: { nextToken, rowCount },
  };
}

function remove(
  entityType: CloudSyncEvent["entityType"],
  entityId: number,
  resumeCursor?: string,
): CloudSyncEvent {
  return {
    cloudEventId: `cloud:${entityType}:${entityId}:gone`,
    entityType,
    entityId,
    operation: "delete",
    occurredAt: NEWER_UPDATED_AT,
    payload: { id: entityId },
    ...(resumeCursor === undefined ? {} : { resumeCursor }),
  };
}

function upsert(
  entityType: CloudSyncEvent["entityType"],
  entityId: number,
  payload: Record<string, unknown>,
  resumeCursor?: string,
): CloudSyncEvent {
  return {
    cloudEventId: `cloud:${entityType}:${entityId}:up`,
    entityType,
    entityId,
    operation: "upsert",
    occurredAt: NEWER_UPDATED_AT,
    payload,
    ...(resumeCursor === undefined ? {} : { resumeCursor }),
  };
}

const customerRow = (name: string, updatedAt = BASE_UPDATED_AT) => ({
  id: 123,
  name,
  taxId: "12345678000199",
  email: "c@example.com",
  phone: null,
  address: null,
  compliance: null,
  updatedAt,
});
const assetRow = (name: string) => ({
  id: 456,
  customerId: 123,
  assetTypeId: 10,
  name,
  serialNumber: "SN-456",
  tag: "TAG-456",
  status: "ACTIVE",
  updatedAt: BASE_UPDATED_AT,
});
const jobRow = (status: string) => ({
  id: 789,
  jobId: "J-789",
  customerId: 123,
  assetId: 456,
  serviceId: 5,
  unitId: 1,
  status,
  data: {},
  createdAt: BASE_UPDATED_AT,
  updatedAt: BASE_UPDATED_AT,
});
const serviceOrderRow = {
  id: 987,
  serviceOrderNumber: "OS-1",
  customerId: 123,
  assetId: 456,
  unitId: 1,
  status: "awaiting_tech_evaluation",
  priority: "normal",
  claimedDefect: "x",
  intakeCondition: "y",
  updatedAt: BASE_UPDATED_AT,
};

function count(database: Database, table: string, where = "1 = 1") {
  return (
    database
      .prepare<
        [],
        { total: number }
      >(`SELECT COUNT(*) AS total FROM ${table} WHERE ${where}`)
      .get()?.total ?? 0
  );
}

function column(
  database: Database,
  table: string,
  id: string,
  name: string,
): unknown {
  return database
    .prepare<
      [string],
      Record<string, unknown>
    >(`SELECT ${name} FROM ${table} WHERE id = ?`)
    .get(id)?.[name];
}

function seedEverything(database: Database) {
  applySyncBootstrap(
    database,
    bootstrap({
      assetTypes: [
        { id: 10, name: "Balança", slug: "balanca", definition: [] },
      ],
      customers: [customerRow("Cliente")],
      assets: [assetRow("Balança 1")],
      services: [{ id: 5, name: "Calibração", isActive: true }],
      standards: [
        {
          id: 77,
          name: "Padrão",
          serialNumber: "S",
          certificateNumber: "C",
          status: "ACTIVE",
          unitId: 1,
        },
      ],
      environmentalLimits: [{ id: 31, unitId: 1, limits: {} }],
      jobs: [jobRow("DRAFT")],
      serviceOrders: [serviceOrderRow],
      publishedMethods: [{ id: 41, name: "Método", version: 1 }],
      massCompositionProfiles: [
        { id: 51, profileKey: "1kg", profileClass: "M1", nominalG: 1000 },
      ],
    }),
    PULLED_AT,
  );
}

describe("REQ-CS-2: delete events remove the local mirror of every entity", () => {
  it("REQ-CS-2: a delete event removes (or marks deleted) the row of each of the ten entity types", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    seedEverything(database);
    expect(count(database, "asset_types")).toBe(1);

    applySyncPullResponse(
      database,
      {
        cursor: "v3|60|0",
        hasMore: false,
        events: [
          remove("asset_type", 10),
          remove("customer", 123),
          remove("asset", 456),
          remove("service", 5),
          remove("reference_standard", 77),
          remove("environmental_limit", 31),
          remove("calibration_job", 789),
          remove("service_order", 987),
          remove("published_method", 41),
          remove("mass_composition_profile", 51),
        ],
      },
      SECOND_PULL_AT,
    );

    expect(count(database, "asset_types")).toBe(0);
    expect(count(database, "services")).toBe(0);
    expect(count(database, "environmental_limits")).toBe(0);
    expect(count(database, "service_orders")).toBe(0);
    expect(count(database, "published_methods")).toBe(0);
    expect(count(database, "mass_composition_profiles")).toBe(0);
    // The rows local history points at are marked, not erased.
    expect(column(database, "customers", "customer:123", "deleted_at")).toBe(
      NEWER_UPDATED_AT,
    );
    expect(column(database, "assets", "asset:456", "deleted_at")).toBe(
      NEWER_UPDATED_AT,
    );
    expect(column(database, "calibration_jobs", "job:789", "deleted_at")).toBe(
      NEWER_UPDATED_AT,
    );
    expect(
      column(database, "reference_standards", "standard:77", "sync_state"),
    ).toBe("deleted");
    expect(getSyncCursor(database)).toBe("v3|60|0");
    database.close();
  });

  it("REQ-CS-2: a delete for a row this desktop never had is a no-op, not an error", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    applySyncBootstrap(database, bootstrap({}), PULLED_AT);
    const summary = applySyncPullResponse(
      database,
      {
        cursor: "v3|60|0",
        hasMore: false,
        events: [remove("service_order", 999), remove("calibration_job", 998)],
      },
      SECOND_PULL_AT,
    );
    expect(summary.skipped).toEqual([]);
    database.close();
  });

  it("REQ-CS-2: a row that comes back into scope after a delete is live again", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    seedEverything(database);
    applySyncPullResponse(
      database,
      {
        cursor: "v3|60|0",
        hasMore: false,
        events: [remove("calibration_job", 789), remove("customer", 123)],
      },
      SECOND_PULL_AT,
    );
    expect(
      column(database, "calibration_jobs", "job:789", "deleted_at"),
    ).not.toBe(null);

    applySyncPullResponse(
      database,
      {
        cursor: "v3|70|0",
        hasMore: false,
        events: [
          upsert("customer", 123, customerRow("Cliente", NEWER_UPDATED_AT)),
          upsert("calibration_job", 789, jobRow("IN_PROGRESS")),
        ],
      },
      SECOND_PULL_AT,
    );
    expect(column(database, "calibration_jobs", "job:789", "deleted_at")).toBe(
      null,
    );
    expect(column(database, "customers", "customer:123", "deleted_at")).toBe(
      null,
    );
    database.close();
  });

  it("REQ-CS-2: a delete is not applied to a customer with queued local changes: it is skipped, with the log position to come back to", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    seedEverything(database);
    updateLocalCustomer(database, {
      identifier: "customer:123",
      name: "Editado offline",
      actorUserId: "user-1",
      deviceId: "device-1",
    });

    const summary = applySyncPullResponse(
      database,
      {
        cursor: "v3|60|0",
        hasMore: false,
        events: [remove("customer", 123, "v3|58|6")],
      },
      SECOND_PULL_AT,
    );

    expect(summary.skipped).toEqual([
      { entityType: "customer", localId: "customer:123" },
    ]);
    expect(column(database, "customers", "customer:123", "deleted_at")).toBe(
      null,
    );
    expect(column(database, "customers", "customer:123", "name")).toBe(
      "Editado offline",
    );
    const skipped = database
      .prepare<
        [],
        { resume_cursor: string | null }
      >("SELECT resume_cursor FROM sync_skipped_rows")
      .all();
    expect(skipped).toEqual([{ resume_cursor: "v3|58|6" }]);
    database.close();
  });

  it("REQ-CS-2: once the queued change settles, the cursor rewinds to just before the skipped delete and the next pull applies it", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    seedEverything(database);
    updateLocalCustomer(database, {
      identifier: "customer:123",
      name: "Editado offline",
      actorUserId: "user-1",
      deviceId: "device-1",
    });
    applySyncPullResponse(
      database,
      {
        cursor: "v3|60|0",
        hasMore: false,
        events: [remove("customer", 123, "v3|58|6")],
      },
      SECOND_PULL_AT,
    );
    expect(getSyncCursor(database)).toBe("v3|60|0");
    expect(releaseSettledSkippedRows(database)).toBe(0);

    // The cloud refuses the edit of a deleted customer: the conflict is ignored.
    const queued = listPendingOutboxEvents(database, 50, {
      includeDeferred: true,
    }).find((event) => event.entityType === "customer");
    if (!queued) throw new Error("expected a queued customer event");
    applySyncPushResult(database, {
      accepted: [],
      rejected: [],
      conflicts: [
        {
          id: "conflict-1",
          eventId: queued.eventId,
          entityType: "customer",
          entityId: queued.entityId,
          conflictType: "concurrent_update",
          status: "open",
        },
      ],
    });
    resolveSyncConflict(database, "conflict-1", "ignored");

    expect(countSkippedRows(database)).toBe(0);
    expect(getSyncCursor(database)).toBe("v3|58|6");

    applySyncPullResponse(
      database,
      {
        cursor: "v3|60|0",
        hasMore: false,
        events: [remove("customer", 123, "v3|58|6")],
      },
      SECOND_PULL_AT,
    );
    expect(
      column(database, "customers", "customer:123", "deleted_at"),
    ).not.toBe(null);
    database.close();
  });

  it("REQ-CS-2: a row skipped by a bootstrap page has no log position, so settling it starts the cursor over (the cloud answers: bootstrap again)", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    seedEverything(database);
    setSyncCursor(database, "v3|50|0");
    updateLocalCustomer(database, {
      identifier: "customer:123",
      name: "Editado offline",
      actorUserId: "user-1",
      deviceId: "device-1",
    });
    applySyncBootstrapPage(
      database,
      page({ customers: [customerRow("Nuvem", NEWER_UPDATED_AT)] }, null),
      { first: true },
      SECOND_PULL_AT,
    );
    expect(countSkippedRows(database)).toBe(1);

    const queued = listPendingOutboxEvents(database, 50, {
      includeDeferred: true,
    }).find((event) => event.entityType === "customer");
    if (!queued) throw new Error("expected a queued customer event");
    applySyncPushResult(database, {
      accepted: [],
      rejected: [],
      conflicts: [
        {
          id: "conflict-2",
          eventId: queued.eventId,
          entityType: "customer",
          entityId: queued.entityId,
          conflictType: "concurrent_update",
          status: "open",
        },
      ],
    });
    resolveSyncConflict(database, "conflict-2", "ignored");
    expect(getSyncCursor(database)).toBe(null);
    database.close();
  });
});

describe("REQ-CS-3: the paged bootstrap", () => {
  it("REQ-CS-3: the pull cursor is only set by the LAST page; until then the bootstrap is incomplete and resumable", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });

    applySyncBootstrapPage(
      database,
      page({ assetTypes: [{ id: 10, name: "Balança" }] }, "b3|50|1|0"),
      { first: true },
      PULLED_AT,
    );
    expect(getSyncCursor(database)).toBe(null);
    expect(getBootstrapPageToken(database)).toBe("b3|50|1|0");
    expect(hasIncompleteBootstrap(database)).toBe(true);
    expect(count(database, "asset_types")).toBe(1);

    applySyncBootstrapPage(
      database,
      page({ customers: [customerRow("Cliente")] }, "b3|50|2|0"),
      { first: false },
      PULLED_AT,
    );
    expect(getSyncCursor(database)).toBe(null);
    expect(getBootstrapPageToken(database)).toBe("b3|50|2|0");

    applySyncBootstrapPage(
      database,
      page({ assets: [assetRow("Balança 1")] }, null),
      { first: false },
      PULLED_AT,
    );
    expect(getSyncCursor(database)).toBe("v3|50|0");
    expect(getSyncCursor(database, "bootstrap")).toBe("v3|50|0");
    expect(getBootstrapPageToken(database)).toBe(null);
    expect(hasIncompleteBootstrap(database)).toBe(false);
    expect(count(database, "sync_bootstrap_seen")).toBe(0);
    expect(count(database, "assets")).toBe(1);
    database.close();
  });

  it("REQ-CS-3: an interrupted bootstrap resumes from the last completed page, after the database is reopened", () => {
    const filePath = createTempDatabasePath();
    let database = openLocalDatabase({ filePath });
    applySyncBootstrapPage(
      database,
      page({ assetTypes: [{ id: 10, name: "Balança" }] }, "b3|50|1|0"),
      { first: true },
      PULLED_AT,
    );
    database.close();

    database = openLocalDatabase({ filePath });
    expect(getBootstrapPageToken(database)).toBe("b3|50|1|0");
    expect(hasIncompleteBootstrap(database)).toBe(true);
    // The next request asks for the page after the one applied; applying it finishes.
    applySyncBootstrapPage(
      database,
      page({ customers: [customerRow("Cliente")] }, null),
      { first: false },
      PULLED_AT,
    );
    expect(hasIncompleteBootstrap(database)).toBe(false);
    expect(count(database, "asset_types")).toBe(1);
    expect(count(database, "customers")).toBe(1);
    expect(getSyncCursor(database)).toBe("v3|50|0");
    database.close();
  });

  it("REQ-CS-3: starting a bootstrap drops the old pull cursor and the delivered ids of an abandoned one; discarding forgets the progress", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    setSyncCursor(database, "v3|10|0");
    applySyncBootstrapPage(
      database,
      page({ assetTypes: [{ id: 10, name: "A" }] }, "b3|50|1|0"),
      { first: true },
      PULLED_AT,
    );
    expect(getSyncCursor(database)).toBe(null);
    expect(count(database, "sync_bootstrap_seen")).toBe(1);

    discardBootstrapProgress(database);
    expect(hasIncompleteBootstrap(database)).toBe(false);
    expect(count(database, "sync_bootstrap_seen")).toBe(0);

    applySyncBootstrapPage(
      database,
      page({ assetTypes: [{ id: 11, name: "B" }] }, null),
      { first: true },
      PULLED_AT,
    );
    expect(count(database, "sync_bootstrap_seen")).toBe(0);
    expect(getSyncCursor(database)).toBe("v3|50|0");
    database.close();
  });

  it("REQ-CS-3: the pages carry every row: what the pages deliver is applied exactly as the unpaged bootstrap applies it", () => {
    const paged = openLocalDatabase({ filePath: createTempDatabasePath() });
    const whole = openLocalDatabase({ filePath: createTempDatabasePath() });
    const rows: Partial<SyncBootstrapResponse> = {
      assetTypes: [
        { id: 10, name: "Balança", slug: "balanca", definition: [] },
      ],
      customers: [customerRow("Cliente")],
      assets: [assetRow("Balança 1")],
      jobs: [jobRow("DRAFT")],
    };
    applySyncBootstrap(whole, bootstrap(rows), PULLED_AT);

    applySyncBootstrapPage(
      paged,
      page({ assetTypes: rows.assetTypes ?? [] }, "t1"),
      { first: true },
      PULLED_AT,
    );
    applySyncBootstrapPage(
      paged,
      page(
        { customers: rows.customers ?? [], assets: rows.assets ?? [] },
        "t2",
      ),
      { first: false },
      PULLED_AT,
    );
    applySyncBootstrapPage(
      paged,
      page({ jobs: rows.jobs ?? [] }, null),
      { first: false },
      PULLED_AT,
    );

    for (const table of [
      "asset_types",
      "customers",
      "assets",
      "calibration_jobs",
    ]) {
      const read = (database: Database) =>
        database.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
      expect(read(paged), table).toEqual(read(whole));
    }
    paged.close();
    whole.close();
  });

  it("REQ-CS-2/5: when the last page lands, a mirror row the cloud no longer delivers is removed; locally created rows and rows with queued changes are not", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    seedEverything(database);
    // The desktop was offline longer than the change log: the cloud deleted the service
    // order, the standard and the customer in the meantime.
    updateLocalCustomer(database, {
      identifier: "customer:123",
      name: "Editado offline",
      actorUserId: "user-1",
      deviceId: "device-1",
    });

    applySyncBootstrapPage(
      database,
      page(
        {
          assetTypes: [
            { id: 10, name: "Balança", slug: "balanca", definition: [] },
          ],
          assets: [assetRow("Balança 1")],
          services: [{ id: 5, name: "Calibração", isActive: true }],
          jobs: [jobRow("DRAFT")],
        },
        null,
      ),
      { first: true },
      SECOND_PULL_AT,
    );

    expect(count(database, "service_orders")).toBe(0);
    expect(
      column(database, "reference_standards", "standard:77", "sync_state"),
    ).toBe("deleted");
    expect(count(database, "environmental_limits")).toBe(0);
    expect(count(database, "published_methods")).toBe(0);
    expect(count(database, "mass_composition_profiles")).toBe(0);
    // Kept: delivered rows, and the customer whose edit is queued.
    expect(count(database, "asset_types")).toBe(1);
    expect(count(database, "services")).toBe(1);
    expect(column(database, "assets", "asset:456", "deleted_at")).toBe(null);
    expect(column(database, "customers", "customer:123", "deleted_at")).toBe(
      null,
    );
    expect(column(database, "customers", "customer:123", "name")).toBe(
      "Editado offline",
    );
    expect(countSkippedRows(database)).toBe(1);
    database.close();
  });

  it("REQ-CS-3: a bootstrap page keeps only the session header in the snapshot, not the rows", () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    applySyncBootstrapPage(
      database,
      page({ customers: [customerRow("Cliente")] }, null),
      { first: true },
      PULLED_AT,
    );
    const snapshot = database
      .prepare<
        [],
        { snapshot_json: string }
      >("SELECT snapshot_json FROM tenant_snapshot")
      .get();
    expect(JSON.parse(snapshot?.snapshot_json ?? "{}").customers).toEqual([]);
    database.close();
  });
});
