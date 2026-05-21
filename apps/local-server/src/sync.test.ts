import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  applySyncBootstrap,
  createLocalCustomer,
  listPendingOutboxEvents,
  markOutboxEventsFailedForRetry,
  openLocalDatabase,
} from "@calibra-facil/local-db";
import type { LocalServerConfig } from "./bootstrap";
import { createLocalSyncRuntime } from "./sync";

const tempDirectories: string[] = [];

function createTempDatabasePath() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-sync-test-"));
  tempDirectories.push(directory);
  return path.join(directory, "calibra.sqlite");
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createConfig(dbPath: string): LocalServerConfig {
  return {
    host: "127.0.0.1",
    port: 4317,
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
    cloudApiUrl: null,
    cloudAuthToken: null,
    cloudProxyToken: null,
    desktopRunId: "desktop-test-run",
    localServerRunId: "local-server-test-run",
  };
}

describe("createLocalSyncRuntime", () => {
  it("records sync run ids and last errors in status snapshots", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    const runtime = createLocalSyncRuntime(createConfig(dbPath), database);

    await expect(runtime.runInitialSync()).rejects.toThrow(
      "Cloud API URL is not configured for local sync",
    );

    expect(runtime.getStatus()).toMatchObject({
      state: "error",
      activeRunId: null,
      lastRunId: expect.stringMatching(/^initial-/),
      lastError: "Cloud API URL is not configured for local sync",
    });

    database.close();
  });

  it("uses synced tenant context for outbound events after packaged startup", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    const config = {
      ...createConfig(dbPath),
      organizationId: null,
      unitId: null,
      userId: null,
      cloudApiUrl: "https://api.example.test",
    };
    const pushedRequests: unknown[] = [];
    const runtime = createLocalSyncRuntime(config, database, {
      fetch: async (input, init) => {
        const url = String(input);

        if (url === "https://api.example.test/api/sync/push") {
          const body = JSON.parse(String(init?.body));
          pushedRequests.push(body);

          return Response.json({
            accepted: body.events.map(
              (event: { eventId: string; localVersion: number }) => ({
                eventId: event.eventId,
                remoteEntityId: 123,
                remoteVersion: event.localVersion + 1,
                cloudEventId: `cloud:${event.eventId}`,
              }),
            ),
            rejected: [],
            conflicts: [],
            newCursor: "cursor-after-push",
          });
        }

        if (url.startsWith("https://api.example.test/api/sync/pull")) {
          return Response.json({
            cursor: "cursor-after-pull",
            hasMore: false,
            events: [],
          });
        }

        throw new Error(`Unexpected URL ${url}`);
      },
    });

    applySyncBootstrap(
      database,
      syncBootstrap("org-synced", 42, "user-synced"),
    );
    createLocalCustomer(database, {
      organizationId: "org-synced",
      unitId: 42,
      name: "Cliente Offline",
      email: "offline@example.com",
      actorUserId: "user-synced",
      deviceId: "device-test",
    });

    await expect(runtime.runPushSync()).resolves.toMatchObject({
      state: "idle",
      pendingOutboxCount: 0,
      conflictCount: 0,
      lastError: null,
    });

    expect(pushedRequests).toHaveLength(1);
    expect(pushedRequests[0]).toMatchObject({
      events: [
        {
          actorUserId: "user-synced",
          organizationId: "org-synced",
          unitId: 42,
        },
      ],
    });

    database.close();
  });

  it("manual sync retries failed outbox events even when retry backoff is pending", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    const config = {
      ...createConfig(dbPath),
      cloudApiUrl: "https://api.example.test",
    };
    const pushedRequests: unknown[] = [];
    const runtime = createLocalSyncRuntime(config, database, {
      fetch: async (input, init) => {
        const url = String(input);

        if (url === "https://api.example.test/api/sync/push") {
          const body = JSON.parse(String(init?.body));
          pushedRequests.push(body);

          return Response.json({
            accepted: body.events.map(
              (event: { eventId: string; localVersion: number }) => ({
                eventId: event.eventId,
                remoteEntityId: 321,
                remoteVersion: event.localVersion + 1,
                cloudEventId: `cloud:${event.eventId}`,
              }),
            ),
            rejected: [],
            conflicts: [],
            newCursor: "cursor-after-push",
          });
        }

        if (url === "https://api.example.test/api/sync/bootstrap") {
          return Response.json(syncBootstrap("org-1", 1, "user-1"));
        }

        if (url.startsWith("https://api.example.test/api/sync/pull")) {
          return Response.json({
            cursor: "cursor-after-pull",
            hasMore: false,
            events: [],
          });
        }

        throw new Error(`Unexpected URL ${url}`);
      },
    });

    createLocalCustomer(database, {
      organizationId: "org-1",
      unitId: 1,
      name: "Cliente Offline",
      actorUserId: "user-1",
      deviceId: "device-test",
    });
    const [event] = listPendingOutboxEvents(database);
    if (!event) throw new Error("Expected one pending outbox event");

    markOutboxEventsFailedForRetry(database, [event.eventId], "offline");
    expect(listPendingOutboxEvents(database)).toHaveLength(0);

    await expect(runtime.runInitialSync()).resolves.toMatchObject({
      state: "idle",
      pendingOutboxCount: 0,
      conflictCount: 0,
    });
    expect(pushedRequests).toHaveLength(1);

    database.close();
  });

  it("serializes overlapping sync runs so one local event is pushed once", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    const config = {
      ...createConfig(dbPath),
      cloudApiUrl: "https://api.example.test",
    };
    let activePushes = 0;
    let maxActivePushes = 0;
    const pushedEventIds = new Set<string>();
    const pushedRequests: unknown[] = [];
    const runtime = createLocalSyncRuntime(config, database, {
      fetch: async (input, init) => {
        const url = String(input);

        if (url === "https://api.example.test/api/sync/push") {
          activePushes += 1;
          maxActivePushes = Math.max(maxActivePushes, activePushes);
          const body = JSON.parse(String(init?.body));
          pushedRequests.push(body);

          const events =
            body && typeof body === "object" && !Array.isArray(body)
              ? Object.fromEntries(Object.entries(body)).events
              : [];
          const syncEvents = Array.isArray(events) ? events : [];

          for (const event of syncEvents) {
            if (!event || typeof event !== "object" || Array.isArray(event)) {
              continue;
            }

            const eventId = Object.fromEntries(Object.entries(event)).eventId;
            if (typeof eventId === "string") {
              pushedEventIds.add(eventId);
            }
          }

          await delay(20);
          activePushes -= 1;

          return Response.json({
            accepted: body.events.map(
              (event: { eventId: string; localVersion: number }) => ({
                eventId: event.eventId,
                remoteEntityId: 456,
                remoteVersion: event.localVersion + 1,
                cloudEventId: `cloud:${event.eventId}`,
              }),
            ),
            rejected: [],
            conflicts: [],
            newCursor: "cursor-after-push",
          });
        }

        if (url === "https://api.example.test/api/sync/bootstrap") {
          return Response.json(syncBootstrap("org-1", 1, "user-1"));
        }

        if (url.startsWith("https://api.example.test/api/sync/pull")) {
          return Response.json({
            cursor: "cursor-after-pull",
            hasMore: false,
            events: [],
          });
        }

        throw new Error(`Unexpected URL ${url}`);
      },
    });

    createLocalCustomer(database, {
      organizationId: "org-1",
      unitId: 1,
      name: "Cliente Offline",
      actorUserId: "user-1",
      deviceId: "device-test",
    });
    const [event] = listPendingOutboxEvents(database);
    if (!event) throw new Error("Expected one pending outbox event");

    await expect(
      Promise.all([
        runtime.runInitialSync(),
        runtime.runInitialSync(),
        runtime.runPushSync(),
      ]),
    ).resolves.toEqual([
      expect.objectContaining({
        state: "idle",
        pendingOutboxCount: 0,
        conflictCount: 0,
      }),
      expect.objectContaining({
        state: "idle",
        pendingOutboxCount: 0,
        conflictCount: 0,
      }),
      expect.objectContaining({
        state: "idle",
        pendingOutboxCount: 0,
        conflictCount: 0,
      }),
    ]);

    expect(maxActivePushes).toBe(1);
    expect(pushedRequests).toHaveLength(1);
    expect(pushedEventIds).toEqual(new Set([event.eventId]));

    database.close();
  });
});

function syncBootstrap(
  organizationId: string,
  activeUnitId: number,
  userId: string,
) {
  return {
    serverTime: "2026-01-15T10:00:00.000Z",
    user: {
      id: userId,
      name: "Synced User",
      email: "user@example.com",
    },
    organization: {
      id: organizationId,
      type: "LAB",
    },
    activeUnits: [{ id: activeUnitId, name: "Matriz", role: "technician" }],
    permissions: {
      role: "technician",
      unitRole: "technician",
      activeUnitId,
      accessibleUnitIds: [activeUnitId],
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
}
