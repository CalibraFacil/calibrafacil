import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { SyncBootstrapResponse } from "@calibra-facil/contracts";
import {
  applySyncBootstrap,
  listPendingOutboxEvents,
  openLocalDatabase,
  saveLocalJobExecution,
} from "./index";

// The desktop records WHEN the calibration was performed explicitly, with the
// cloud's rules (POST /jobs/:id/submit): not in the future, and a written
// reason once it is more than 7 days back. Until now `performed_at` was never
// written locally and the sync apply guessed from the event time.

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

type Database = ReturnType<typeof openLocalDatabase>;

function createDatabaseWithJob(): Database {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-performed-"));
  tempDirectories.push(directory);
  const database = openLocalDatabase({
    filePath: path.join(directory, "calibra.sqlite"),
  });
  const bootstrap: SyncBootstrapResponse = {
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
    jobs: [
      {
        id: 789,
        jobId: "J-789",
        customerId: 123,
        assetId: 456,
        serviceId: 5,
        unitId: 1,
        status: "DRAFT",
        data: {},
        createdAt: "2026-01-15T10:00:00.000Z",
        updatedAt: "2026-01-15T10:00:00.000Z",
      },
    ],
    serviceOrders: [],
  };
  applySyncBootstrap(database, bootstrap, "2026-01-15T11:00:00.000Z");
  return database;
}

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function queuedExecution(database: Database) {
  const events = listPendingOutboxEvents(database, 50, {
    includeDeferred: true,
  }).filter((event) => event.entityType === "calibration_job");
  const event = events.at(-1);
  if (!event) throw new Error("Expected a queued execution event");
  const payload: Record<string, unknown> =
    event.payload && typeof event.payload === "object"
      ? Object.fromEntries(Object.entries(event.payload))
      : {};
  return { operation: event.operation, payload };
}

function storedPerformedAt(database: Database) {
  return database
    .prepare<
      [],
      { performed_at: string | null; status: string }
    >("SELECT performed_at, status FROM calibration_jobs WHERE id = 'job:789'")
    .get();
}

const baseInput = {
  routeId: "789",
  actorUserId: "user-1",
  deviceId: "device-1",
  data: { reading: 1 },
};

describe("explicit execution time on the desktop", () => {
  it("stores and queues the performed date chosen on a draft save", () => {
    const database = createDatabaseWithJob();
    const performedAt = daysAgoIso(2);

    saveLocalJobExecution(database, { ...baseInput, performedAt });

    expect(storedPerformedAt(database)?.performed_at).toBe(performedAt);
    expect(queuedExecution(database)).toMatchObject({
      operation: "save_local_execution",
      payload: { performedAt },
    });

    database.close();
  });

  it("ignores an unparseable date on a draft save, like the cloud", () => {
    const database = createDatabaseWithJob();

    saveLocalJobExecution(database, { ...baseInput, performedAt: "ontem" });

    expect(storedPerformedAt(database)?.performed_at).toBeNull();
    expect(queuedExecution(database).payload).not.toHaveProperty("performedAt");

    database.close();
  });

  it("submits with the chosen date", () => {
    const database = createDatabaseWithJob();
    const performedAt = daysAgoIso(3);

    saveLocalJobExecution(database, {
      ...baseInput,
      performedAt,
      requireResults: true,
    });

    expect(storedPerformedAt(database)).toEqual({
      performed_at: performedAt,
      status: "REVIEW",
    });
    const { operation, payload } = queuedExecution(database);
    expect(operation).toBe("submit_local_execution");
    expect(payload.performedAt).toBe(performedAt);
    expect(payload).not.toHaveProperty("backdateReason");

    database.close();
  });

  it("submits at the current time when no date is given", () => {
    const database = createDatabaseWithJob();
    const before = Date.now();

    saveLocalJobExecution(database, { ...baseInput, requireResults: true });

    const { payload } = queuedExecution(database);
    const performedAt = Date.parse(String(payload.performedAt));
    expect(performedAt).toBeGreaterThanOrEqual(before);
    expect(performedAt).toBeLessThanOrEqual(Date.now());

    database.close();
  });

  it("refuses a submit dated in the future and queues nothing", () => {
    const database = createDatabaseWithJob();

    expect(() =>
      saveLocalJobExecution(database, {
        ...baseInput,
        performedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        requireResults: true,
      }),
    ).toThrow("A data de execução não pode estar no futuro");

    expect(storedPerformedAt(database)).toEqual({
      performed_at: null,
      status: "DRAFT",
    });
    expect(listPendingOutboxEvents(database, 50)).toHaveLength(0);

    database.close();
  });

  it("requires a reason for a submit more than 7 days back", () => {
    const database = createDatabaseWithJob();

    expect(() =>
      saveLocalJobExecution(database, {
        ...baseInput,
        performedAt: daysAgoIso(10),
        requireResults: true,
      }),
    ).toThrow("Motivo obrigatório para lançamentos com mais de 7 dias");
    expect(listPendingOutboxEvents(database, 50)).toHaveLength(0);

    database.close();
  });

  it("queues the trimmed reason with a backdated submit", () => {
    const database = createDatabaseWithJob();
    const performedAt = daysAgoIso(10);

    saveLocalJobExecution(database, {
      ...baseInput,
      performedAt,
      backdateReason: "  Sem sinal no cliente  ",
      requireResults: true,
    });

    const { payload } = queuedExecution(database);
    expect(payload.performedAt).toBe(performedAt);
    expect(payload.backdateReason).toBe("Sem sinal no cliente");

    database.close();
  });
});
