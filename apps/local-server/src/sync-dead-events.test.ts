import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applySyncBootstrap,
  applySyncPushResult,
  createLocalCustomer,
  markOutboxEventsFailedForRetry,
  openLocalDatabase,
  type LocalDatabase,
} from "@calibra-facil/local-db";
import type { SyncStatusSnapshot } from "@calibra-facil/contracts";
import type { LocalServerConfig } from "./bootstrap";
import { createLocalServer } from "./server";
import { createLocalSyncRuntime, type LocalSyncRuntime } from "./sync";
import { createLocalSyncScheduler } from "./sync-scheduler";

const tempDirectories: string[] = [];

function createTempDatabasePath() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-dead-sync-"));
  tempDirectories.push(directory);
  return path.join(directory, "calibra.sqlite");
}

afterEach(() => {
  vi.useRealTimers();
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createConfig(dbPath: string): LocalServerConfig {
  return {
    host: "127.0.0.1",
    port: 4318,
    appVersion: "test",
    localServerVersion: "test",
    dbPath,
    storageRoot: path.join(path.dirname(dbPath), "files"),
    deviceId: "device-test",
    tenantId: null,
    organizationId: "org-1",
    unitId: 1,
    userId: "user-1",
    syncEnabled: true,
    bootstrapToken: null,
    cloudApiUrl: "https://api.example.test",
    cloudAuthToken: null,
    cloudProxyToken: null,
    desktopRunId: "desktop-test-run",
    localServerRunId: "local-server-test-run",
  };
}

const bootstrapBody = {
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
  syncCursor: "cursor-after-bootstrap",
  publishedMethods: [],
  assetTypes: [],
  customers: [],
  assets: [],
  services: [],
  standards: [],
  environmentalLimits: [],
  jobs: [],
  serviceOrders: [],
};

function seedTenant(database: LocalDatabase) {
  applySyncBootstrap(database, bootstrapBody);
}

function queueCustomer(database: LocalDatabase, name: string) {
  const before = new Set(
    database
      .prepare<[], { event_id: string }>("SELECT event_id FROM domain_events")
      .all()
      .map((row) => row.event_id),
  );
  createLocalCustomer(database, {
    organizationId: "org-1",
    unitId: 1,
    name,
    actorUserId: "user-1",
    deviceId: "device-test",
  });
  const created = database
    .prepare<[], { event_id: string }>(
      "SELECT event_id FROM domain_events ORDER BY sequence",
    )
    .all()
    .find((row) => !before.has(row.event_id));
  if (!created) throw new Error(`No event recorded for ${name}`);
  return created.event_id;
}

function killEvent(database: LocalDatabase, eventId: string, code: string) {
  applySyncPushResult(database, {
    accepted: [],
    rejected: [{ eventId, code, reason: `refused: ${code}` }],
    conflicts: [],
  });
}

function pushedEventIds(body: BodyInit | null | undefined): string[] {
  const parsed: unknown = JSON.parse(String(body));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const events = Object.fromEntries(Object.entries(parsed)).events;
  if (!Array.isArray(events)) return [];
  return events.flatMap((event): string[] => {
    if (!event || typeof event !== "object" || Array.isArray(event)) return [];
    const eventId = Object.fromEntries(Object.entries(event)).eventId;
    return typeof eventId === "string" ? [eventId] : [];
  });
}

/** A cloud that accepts every pushed event and records what it was sent. */
function recordingCloud() {
  const pushes: string[][] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://api.example.test/api/sync/push") {
      const eventIds = pushedEventIds(init?.body);
      pushes.push(eventIds);
      return Response.json({
        accepted: eventIds.map((eventId) => ({
          eventId,
          remoteVersion: 1,
          cloudEventId: `cloud:${eventId}`,
        })),
        rejected: [],
        conflicts: [],
      });
    }
    if (url === "https://api.example.test/api/sync/bootstrap") {
      return Response.json(bootstrapBody);
    }
    if (url.startsWith("https://api.example.test/api/sync/pull")) {
      return Response.json({
        cursor: "cursor-after-pull",
        hasMore: false,
        events: [],
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  return { pushes, fetchImpl };
}

describe("REQ-OB-2: the push cycle skips dead and backing-off events", () => {
  it("REQ-OB-2: a newer event is pushed with 60 dead events ahead of it", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    seedTenant(database);
    for (let index = 0; index < 60; index += 1) {
      killEvent(
        database,
        queueCustomer(database, `Morto ${index}`),
        "UNSUPPORTED_SYNC_OPERATION",
      );
    }
    const newest = queueCustomer(database, "Novo");
    const cloud = recordingCloud();
    const runtime = createLocalSyncRuntime(createConfig(dbPath), database, {
      fetch: cloud.fetchImpl,
    });

    const status = await runtime.runPushSync();

    expect(cloud.pushes).toEqual([[newest]]);
    expect(status).toMatchObject({
      state: "idle",
      pendingOutboxCount: 0,
      deadOutboxCount: 60,
    });

    database.close();
  });

  it("REQ-OB-2: a newer event is pushed with 60 backing-off events ahead of it", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    seedTenant(database);
    const waiting: string[] = [];
    for (let index = 0; index < 60; index += 1) {
      waiting.push(queueCustomer(database, `Esperando ${index}`));
    }
    markOutboxEventsFailedForRetry(database, waiting, "offline");
    const newest = queueCustomer(database, "Novo");
    const cloud = recordingCloud();
    const runtime = createLocalSyncRuntime(createConfig(dbPath), database, {
      fetch: cloud.fetchImpl,
    });

    const status = await runtime.runPushSync();

    expect(cloud.pushes).toEqual([[newest]]);
    expect(status).toMatchObject({
      pendingOutboxCount: 60,
      deferredOutboxCount: 60,
    });

    database.close();
  });

  it("REQ-OB-2: a deliberate sync still retries events that are backing off, due ones first", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    seedTenant(database);
    const waiting: string[] = [];
    for (let index = 0; index < 60; index += 1) {
      waiting.push(queueCustomer(database, `Esperando ${index}`));
    }
    markOutboxEventsFailedForRetry(database, waiting, "offline");
    const newest = queueCustomer(database, "Novo");
    const cloud = recordingCloud();
    const runtime = createLocalSyncRuntime(createConfig(dbPath), database, {
      fetch: cloud.fetchImpl,
    });

    await runtime.runPushSync({ includeDeferred: true });

    expect(cloud.pushes).toHaveLength(1);
    expect(cloud.pushes[0]).toHaveLength(50);
    expect(cloud.pushes[0]?.[0]).toBe(newest);

    database.close();
  });
});

function fakeRuntime(): LocalSyncRuntime & {
  runPushSync: ReturnType<typeof vi.fn>;
} {
  const snapshot: SyncStatusSnapshot = {
    state: "idle",
    pendingOutboxCount: 0,
    conflictCount: 0,
    lastSyncedAt: null,
  };
  return {
    getStatus: () => snapshot,
    runInitialSync: async () => snapshot,
    runPushSync: vi.fn(async () => snapshot),
  };
}

describe("REQ-OB-2: the scheduler only skips the retry delay on a deliberate trigger", () => {
  it.each([
    ["manual", true],
    ["reconnect", true],
    ["startup", true],
    ["poll", false],
    ["local-mutation", false],
  ] as const)(
    "REQ-OB-2: a %s run includes deferred events: %s",
    async (trigger, expected) => {
      const runtime = fakeRuntime();
      const scheduler = createLocalSyncScheduler(runtime, {
        mutationDebounceMs: 0,
        pollIntervalMs: 1_000_000,
      });

      scheduler.start(trigger);
      await vi.waitFor(() => expect(runtime.runPushSync).toHaveBeenCalled());
      scheduler.stop();

      expect(runtime.runPushSync).toHaveBeenCalledWith({
        includeDeferred: expected,
      });
    },
  );

  it("REQ-OB-2: backing-off events do not make the scheduler drain at the fast interval", async () => {
    vi.useFakeTimers();
    const runtime = fakeRuntime();
    runtime.runPushSync.mockResolvedValue({
      state: "idle",
      pendingOutboxCount: 60,
      deferredOutboxCount: 60,
      conflictCount: 0,
      lastSyncedAt: null,
    });
    const scheduler = createLocalSyncScheduler(runtime, {
      drainIntervalMs: 2_000,
      pollIntervalMs: 120_000,
    });

    scheduler.start("startup");
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.runPushSync).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(runtime.runPushSync).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(runtime.runPushSync).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });
});

describe("REQ-OB-3: local routes for dead events", () => {
  it("REQ-OB-3: lists dead events, discards one, and keeps the rest of the queue", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    seedTenant(database);
    const deadId = queueCustomer(database, "Morto");
    const otherDeadId = queueCustomer(database, "Outro morto");
    killEvent(database, deadId, "STANDARD_EXPIRED");
    killEvent(database, otherDeadId, "UNSUPPORTED_SYNC_OPERATION");
    const livingId = queueCustomer(database, "Vivo");
    const app = createLocalServer(createConfig(dbPath), database, {
      fetch: recordingCloud().fetchImpl,
    });

    const list = await app.request("/api/local/sync/dead-events");
    expect(list.status).toBe(200);
    const listed: unknown = await list.json();
    expect(listed).toMatchObject({
      total: 2,
      data: expect.arrayContaining([
        expect.objectContaining({
          eventId: deadId,
          errorCode: "STANDARD_EXPIRED",
          errorMessage: "refused: STANDARD_EXPIRED",
          regulated: false,
        }),
      ]),
    });

    const discard = await app.request(
      `/api/local/sync/dead-events/${encodeURIComponent(deadId)}/discard`,
      { method: "POST" },
    );
    expect(discard.status).toBe(200);
    expect(await discard.json()).toMatchObject({
      data: { eventId: deadId },
      syncStatus: { deadOutboxCount: 1, pendingOutboxCount: 1 },
    });

    const after = await app.request("/api/local/sync/dead-events");
    expect(await after.json()).toMatchObject({
      total: 1,
      data: [{ eventId: otherDeadId }],
    });
    expect(livingId).toEqual(expect.any(String));

    const again = await app.request(
      `/api/local/sync/dead-events/${encodeURIComponent(deadId)}/discard`,
      { method: "POST" },
    );
    expect(again.status).toBe(404);

    database.close();
  });

  it("REQ-OB-3: re-queues a dead event and the next push sends it", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    seedTenant(database);
    const deadId = queueCustomer(database, "Morto");
    killEvent(database, deadId, "STANDARD_EXPIRED");
    const cloud = recordingCloud();
    const app = createLocalServer(createConfig(dbPath), database, {
      fetch: cloud.fetchImpl,
    });

    const requeue = await app.request(
      `/api/local/sync/dead-events/${encodeURIComponent(deadId)}/requeue`,
      { method: "POST" },
    );
    expect(requeue.status).toBe(200);
    expect(await requeue.json()).toMatchObject({
      data: { eventId: deadId },
      syncStatus: { deadOutboxCount: 0, pendingOutboxCount: 1 },
    });

    const runtime = createLocalSyncRuntime(createConfig(dbPath), database, {
      fetch: cloud.fetchImpl,
    });
    await runtime.runPushSync();
    expect(cloud.pushes).toEqual([[deadId]]);

    const missing = await app.request(
      `/api/local/sync/dead-events/${encodeURIComponent(deadId)}/requeue`,
      { method: "POST" },
    );
    expect(missing.status).toBe(404);

    database.close();
  });
});
