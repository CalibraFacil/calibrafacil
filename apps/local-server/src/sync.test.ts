import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  applySyncBootstrap,
  createLocalCustomer,
  getSyncCursor,
  listSyncConflicts,
  listPendingOutboxEvents,
  markOutboxEventsFailedForRetry,
  openLocalDatabase,
  resolveSyncConflict,
  updateLocalCustomer,
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

  it("keeps pulling while the server reports hasMore, resuming from the returned cursor", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    const requestedCursors: Array<string | null> = [];
    const runtime = createLocalSyncRuntime(
      { ...createConfig(dbPath), cloudApiUrl: "https://api.example.test" },
      database,
      {
        fetch: async (input) => {
          const url = new URL(String(input));
          if (url.pathname !== "/api/sync/pull") {
            throw new Error(`Unexpected URL ${url}`);
          }
          requestedCursors.push(url.searchParams.get("cursor"));

          if (requestedCursors.length === 1) {
            return Response.json({
              cursor: "v2|2026-01-15T10:00:01.000Z|customer|7",
              hasMore: true,
              events: [pulledCustomer(7, "Primeira Pagina")],
            });
          }
          return Response.json({
            cursor: "v2|2026-01-15T10:00:05.000Z|customer|9",
            hasMore: false,
            events: [pulledCustomer(9, "Segunda Pagina")],
          });
        },
      },
    );
    applySyncBootstrap(database, syncBootstrap("org-1", 1, "user-1"));

    await runtime.runPushSync();

    expect(requestedCursors).toEqual([
      "cursor-after-bootstrap",
      "v2|2026-01-15T10:00:01.000Z|customer|7",
    ]);
    expect(customerNames(database)).toEqual([
      "Primeira Pagina",
      "Segunda Pagina",
    ]);
    database.close();
  });

  it("pulls from the pull cursor after a push instead of restarting from the push cursor", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    const pullCursors: Array<string | null> = [];
    const pushBaseCursors: Array<string | null> = [];
    const runtime = createLocalSyncRuntime(
      { ...createConfig(dbPath), cloudApiUrl: "https://api.example.test" },
      database,
      {
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === "/api/sync/push") {
            const body = JSON.parse(String(init?.body));
            pushBaseCursors.push(body.baseCursor);
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
              newCursor: `cursor:${body.clientBatchId}:1`,
            });
          }

          pullCursors.push(url.searchParams.get("cursor"));
          return Response.json({
            cursor: "v2|2026-01-15T10:00:01.000Z|customer|7",
            hasMore: false,
            events: [],
          });
        },
      },
    );
    applySyncBootstrap(database, syncBootstrap("org-1", 1, "user-1"));

    for (const name of ["Primeiro", "Segundo"]) {
      createLocalCustomer(database, {
        organizationId: "org-1",
        unitId: 1,
        name,
        actorUserId: "user-1",
        deviceId: "device-test",
      });
      await runtime.runPushSync();
    }

    // The push response's batch marker must never become the pull position:
    // the server cannot parse it and would restart the pull from the epoch.
    expect(pullCursors).toEqual([
      "cursor-after-bootstrap",
      "v2|2026-01-15T10:00:01.000Z|customer|7",
    ]);
    expect(pushBaseCursors).toEqual([
      "cursor-after-bootstrap",
      "v2|2026-01-15T10:00:01.000Z|customer|7",
    ]);
    database.close();
  });

  it("brings back the cloud's version of a row a pull skipped once its conflict is ignored", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    const cloudUpdatedAt = "2026-01-16T08:00:00.000Z";
    const pullCursors: Array<string | null> = [];
    let conflictOnPush = true;
    const runtime = createLocalSyncRuntime(
      { ...createConfig(dbPath), cloudApiUrl: "https://api.example.test" },
      database,
      {
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === "/api/sync/push") {
            const body = JSON.parse(String(init?.body));
            const events: Array<{ eventId: string; entityId: string }> =
              body.events;
            if (!conflictOnPush) {
              return Response.json({
                accepted: [],
                rejected: [],
                conflicts: [],
              });
            }
            return Response.json({
              accepted: [],
              rejected: [],
              conflicts: events.map((event) => ({
                id: `conflict:${event.eventId}`,
                eventId: event.eventId,
                entityType: "customer",
                entityId: event.entityId,
                conflictType: "concurrent_update",
                status: "open",
              })),
            });
          }

          // The cloud answers like the real pull: rows stamped after the cursor.
          const cursor = url.searchParams.get("cursor");
          pullCursors.push(cursor);
          const iso = cursor?.startsWith("v2|") ? cursor.split("|")[1] : cursor;
          const parsed = iso ? Date.parse(iso) : 0;
          // (The bootstrap cursor of these tests is not a date: from the start.)
          const after = Number.isNaN(parsed) ? 0 : parsed;
          return Response.json({
            cursor: `v2|${cloudUpdatedAt}|customer|123`,
            hasMore: false,
            events:
              Date.parse(cloudUpdatedAt) > after
                ? [pulledCustomer(123, "Cloud v2", cloudUpdatedAt)]
                : [],
          });
        },
      },
    );
    applySyncBootstrap(database, {
      ...syncBootstrap("org-1", 1, "user-1"),
      customers: [
        {
          id: 123,
          name: "Cloud v1",
          updatedAt: "2026-01-15T10:00:00.000Z",
        },
      ],
    });
    updateLocalCustomer(database, {
      identifier: "customer:123",
      name: "Edited offline",
      actorUserId: "user-1",
      deviceId: "device-test",
    });

    // First run: the edit conflicts, and the pull skips the row but moves on.
    await runtime.runPushSync();
    expect(customerNames(database)).toEqual(["Edited offline"]);
    expect(getSyncCursor(database)).toBe(`v2|${cloudUpdatedAt}|customer|123`);

    // The user keeps the cloud's version.
    const [conflict] = listSyncConflicts(database).data;
    if (!conflict) throw new Error("Expected an open conflict");
    resolveSyncConflict(database, conflict.id, "ignored");
    conflictOnPush = false;

    await runtime.runPushSync();

    expect(customerNames(database)).toEqual(["Cloud v2"]);
    expect(pullCursors.at(-1)).toBe("2026-01-16T07:59:59.999Z");
    database.close();
  });

  describe("events recorded by another signed-in user", () => {
    function setup(userId: string, dbPath: string) {
      const database = openLocalDatabase({ filePath: dbPath });
      const pushed: Array<{ eventId: string; actorUserId: string }> = [];
      const runtime = createLocalSyncRuntime(
        {
          ...createConfig(dbPath),
          userId,
          cloudApiUrl: "https://api.example.test",
        },
        database,
        {
          fetch: async (input, init) => {
            const url = new URL(String(input));
            if (url.pathname === "/api/sync/push") {
              const body = JSON.parse(String(init?.body));
              pushed.push(...body.events);
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
              });
            }
            return Response.json({
              cursor: "cursor-after-pull",
              hasMore: false,
              events: [],
            });
          },
        },
      );
      return { database, runtime, pushed };
    }

    function record(
      database: ReturnType<typeof openLocalDatabase>,
      name: string,
      actorUserId: string | null,
    ) {
      createLocalCustomer(database, {
        organizationId: "org-1",
        unitId: 1,
        name,
        actorUserId,
        deviceId: "device-test",
      });
    }

    it("does not push them under another user's session, and reports how many wait", async () => {
      const dbPath = createTempDatabasePath();
      const { database, runtime, pushed } = setup("user-bruno", dbPath);
      applySyncBootstrap(database, syncBootstrap("org-1", 1, "user-bruno"));
      record(database, "Da Ana", "user-ana");
      record(database, "Do Bruno", "user-bruno");
      record(database, "Sem autor", null);

      const status = await runtime.runPushSync();

      expect(pushed.map((event) => event.actorUserId)).toEqual([
        "user-bruno",
        "user-bruno",
      ]);
      // Waiting, not failed: untouched until Ana signs in.
      const anaEvent = database
        .prepare<
          [],
          { status: string; attempt_count: number }
        >("SELECT outbox.status, outbox.attempt_count FROM outbox JOIN domain_events ON domain_events.event_id = outbox.event_id WHERE domain_events.actor_user_id = 'user-ana'")
        .get();
      expect(anaEvent).toEqual({ status: "pending", attempt_count: 0 });
      expect(status).toMatchObject({
        pendingOutboxCount: 1,
        pendingForOtherUserCount: 1,
        // Nothing the signed-in user can send is left: not an error.
        state: "idle",
      });
      expect(runtime.getStatus().pendingForOtherUserCount).toBe(1);
      database.close();
    });

    it("pushes them once their author is signed in", async () => {
      const dbPath = createTempDatabasePath();
      const bruno = setup("user-bruno", dbPath);
      applySyncBootstrap(
        bruno.database,
        syncBootstrap("org-1", 1, "user-bruno"),
      );
      record(bruno.database, "Da Ana", "user-ana");
      await bruno.runtime.runPushSync();
      expect(bruno.pushed).toEqual([]);
      bruno.database.close();

      // Same database, now with Ana's session.
      const ana = setup("user-ana", dbPath);
      const status = await ana.runtime.runPushSync();

      expect(ana.pushed.map((event) => event.actorUserId)).toEqual([
        "user-ana",
      ]);
      expect(status).toMatchObject({
        pendingOutboxCount: 0,
        pendingForOtherUserCount: 0,
      });
      ana.database.close();
    });
  });

  it("fails loudly instead of looping when hasMore comes back without a new cursor", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    let pulls = 0;
    const runtime = createLocalSyncRuntime(
      { ...createConfig(dbPath), cloudApiUrl: "https://api.example.test" },
      database,
      {
        fetch: async () => {
          pulls += 1;
          return Response.json({
            cursor: "cursor-after-bootstrap",
            hasMore: true,
            events: [],
          });
        },
      },
    );
    applySyncBootstrap(database, syncBootstrap("org-1", 1, "user-1"));

    await expect(runtime.runPushSync()).rejects.toThrow(
      "Cloud pull made no progress",
    );
    expect(pulls).toBe(1);
    database.close();
  });

  it("keeps an event the server rejected as unsupported in the outbox instead of marking it synced", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    const runtime = createLocalSyncRuntime(
      { ...createConfig(dbPath), cloudApiUrl: "https://api.example.test" },
      database,
      {
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === "/api/sync/push") {
            const body = JSON.parse(String(init?.body));
            return Response.json({
              accepted: [],
              rejected: body.events.map((event: { eventId: string }) => ({
                eventId: event.eventId,
                code: "UNSUPPORTED_SYNC_OPERATION",
                reason: "Sync operation is not supported by this server.",
              })),
              conflicts: [],
            });
          }
          return Response.json({
            cursor: "cursor-after-pull",
            hasMore: false,
            events: [],
          });
        },
      },
    );
    applySyncBootstrap(database, syncBootstrap("org-1", 1, "user-1"));
    createLocalCustomer(database, {
      organizationId: "org-1",
      unitId: 1,
      name: "Cliente Offline",
      actorUserId: "user-1",
      deviceId: "device-test",
    });

    const status = await runtime.runPushSync();

    // REQ-OB-1: an unsupported operation is refused for good, so it leaves the
    // push queue (dead) instead of being retried every cycle, and is counted.
    expect(status.state).toBe("idle");
    expect(status.pendingOutboxCount).toBe(0);
    expect(status.deadOutboxCount).toBe(1);
    const rows = database
      .prepare("SELECT status, last_error FROM outbox")
      .all();
    expect(rows).toEqual([
      expect.objectContaining({
        status: "dead",
        last_error: expect.stringContaining("UNSUPPORTED_SYNC_OPERATION"),
      }),
    ]);
    expect(listPendingOutboxEvents(database)).toHaveLength(0);
    database.close();
  });
});

function pulledCustomer(
  id: number,
  name: string,
  updatedAt = "2026-01-15T10:00:01.000Z",
) {
  return {
    cloudEventId: `cloud:customer:${id}`,
    entityType: "customer",
    entityId: id,
    operation: "upsert",
    occurredAt: updatedAt,
    payload: {
      id,
      name,
      updatedAt,
    },
  };
}

function customerNames(database: ReturnType<typeof openLocalDatabase>) {
  return database
    .prepare<[], { name: string }>("SELECT name FROM customers ORDER BY name")
    .all()
    .map((row) => row.name);
}

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
