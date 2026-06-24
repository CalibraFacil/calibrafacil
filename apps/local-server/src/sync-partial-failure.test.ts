import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applySyncBootstrap,
  createLocalCustomer,
  openLocalDatabase,
  type LocalDatabase,
} from "@calibra-facil/local-db";
import type { LocalServerConfig } from "./bootstrap";
import { createLocalServer } from "./server";

const tempDirectories: string[] = [];

function createTempDatabasePath() {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "calibra-sync-partial-test-"),
  );
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

function seedTenant(database: LocalDatabase) {
  applySyncBootstrap(database, {
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
  });
}

type PushEvent = {
  eventId: string;
  entityType: string;
  entityId: string;
  operation: string;
  localVersion: number;
};

function parsePushEvents(body: BodyInit | null | undefined): PushEvent[] {
  const parsed: unknown = JSON.parse(String(body));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const events = Object.fromEntries(Object.entries(parsed)).events;
  if (!Array.isArray(events)) return [];

  return events.flatMap((event): PushEvent[] => {
    if (!event || typeof event !== "object" || Array.isArray(event)) return [];
    const record = Object.fromEntries(Object.entries(event));
    const eventId = record.eventId;
    const entityType = record.entityType;
    const entityId = record.entityId;
    const operation = record.operation;
    const localVersion = record.localVersion;
    if (
      typeof eventId !== "string" ||
      typeof entityType !== "string" ||
      typeof entityId !== "string" ||
      typeof operation !== "string" ||
      typeof localVersion !== "number"
    ) {
      return [];
    }
    return [{ eventId, entityType, entityId, operation, localVersion }];
  });
}

function emptyPullResponse() {
  return Response.json({
    cursor: "cursor-after-pull",
    hasMore: false,
    events: [],
  });
}

// /api/local/sync/retry runs runInitialSync: push -> bootstrap -> pull. We give
// it a benign bootstrap so the full run completes 200 and the assertions reflect
// the push reconciliation rather than a bootstrap failure.
function bootstrapResponse() {
  return Response.json({
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
  });
}

function readOutboxStatus(database: LocalDatabase, eventId: string) {
  return database
    .prepare<{ eventId: string }, { status: string }>(
      "SELECT status FROM outbox WHERE event_id = @eventId",
    )
    .get({ eventId })?.status;
}

function readEventSyncState(database: LocalDatabase, eventId: string) {
  return database
    .prepare<{ eventId: string }, { sync_state: string }>(
      "SELECT sync_state FROM domain_events WHERE event_id = @eventId",
    )
    .get({ eventId })?.sync_state;
}

function readCustomerRemoteId(database: LocalDatabase, entityId: string) {
  return database
    .prepare<{ entityId: string }, { remote_id: number | null }>(
      "SELECT remote_id FROM customers WHERE id = @entityId",
    )
    .get({ entityId })?.remote_id;
}

function listConflictRows(database: LocalDatabase) {
  return database
    .prepare<
      [],
      {
        id: string;
        event_id: string | null;
        entity_id: string;
        local_payload_json: string;
        remote_payload_json: string;
        status: string;
      }
    >(
      `
SELECT id, event_id, entity_id, local_payload_json, remote_payload_json, status
FROM sync_conflicts
`,
    )
    .all();
}

// The returned LocalCustomer.id is a numeric public id; the real aggregate id
// (and domain_event.aggregate_id) is the internal `customer:<uuid>` string. Seed
// a customer and read back BOTH the string entity id and its outbox event id.
function seedCustomer(database: LocalDatabase, name: string) {
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
    email: `${name.toLowerCase().replace(/\s+/g, "-")}@example.com`,
    actorUserId: "user-1",
    deviceId: "device-test",
  });

  const created = database
    .prepare<
      [],
      { event_id: string; aggregate_id: string }
    >("SELECT event_id, aggregate_id FROM domain_events WHERE aggregate_kind = 'customer'")
    .all()
    .find((row) => !before.has(row.event_id));

  if (!created) throw new Error(`No new domain event for customer ${name}`);
  return { entityId: created.aggregate_id, eventId: created.event_id };
}

describe("local sync partial-failure / conflict reconciliation", () => {
  // GAP 1 [HIGH RISK — no data loss]: a single push response mixing accepted +
  // rejected + conflicts must split the batch correctly; nothing silently dropped.
  it("splits one mixed push batch into synced / failed / conflict without dropping anything", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    seedTenant(database);

    const accepted = seedCustomer(database, "Cliente Aceito");
    const rejected = seedCustomer(database, "Cliente Rejeitado");
    const conflicted = seedCustomer(database, "Cliente Conflito");

    let pushCount = 0;
    const app = createLocalServer(createConfig(dbPath), database, {
      fetch: async (input, init) => {
        const url = String(input);

        if (url === "https://api.example.test/api/sync/push") {
          pushCount += 1;
          const events = parsePushEvents(init?.body);
          expect(events).toHaveLength(3);

          const accept = events.find((e) => e.eventId === accepted.eventId);
          const reject = events.find((e) => e.eventId === rejected.eventId);
          const conflict = events.find((e) => e.eventId === conflicted.eventId);
          if (!accept || !reject || !conflict) {
            throw new Error("Expected all three local events in the batch");
          }

          return Response.json({
            accepted: [
              {
                eventId: accept.eventId,
                remoteEntityId: 9001,
                remoteVersion: accept.localVersion + 1,
                cloudEventId: `cloud:${accept.eventId}`,
              },
            ],
            rejected: [
              {
                eventId: reject.eventId,
                code: "VALIDATION_FAILED",
                reason: "tax id already in use",
              },
            ],
            conflicts: [
              {
                id: "conflict-row-1",
                eventId: conflict.eventId,
                entityType: conflict.entityType,
                entityId: conflict.entityId,
                conflictType: "update_conflict",
                status: "open",
                localPayload: { name: "Cliente Conflito" },
                remotePayload: { name: "Cliente Conflito (nuvem)" },
              },
            ],
            newCursor: "cursor-after-push",
          });
        }

        if (url === "https://api.example.test/api/sync/bootstrap") {
          return bootstrapResponse();
        }

        if (url.startsWith("https://api.example.test/api/sync/pull")) {
          return emptyPullResponse();
        }

        throw new Error(`Unexpected URL ${url}`);
      },
    });

    // /api/local/sync/retry drives runInitialSync (push leg first), which calls
    // applySyncPushResult on the mixed response.
    const response = await app.request("/api/local/sync/retry", {
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(pushCount).toBe(1);

    // Accepted -> synced + remote id written back (outbox.ts:222 + :377).
    expect(readOutboxStatus(database, accepted.eventId)).toBe("synced");
    expect(readEventSyncState(database, accepted.eventId)).toBe("synced");
    expect(readCustomerRemoteId(database, accepted.entityId)).toBe(9001);

    // Rejected -> failed (retryable, NOT silently lost) (outbox.ts:246).
    expect(readOutboxStatus(database, rejected.eventId)).toBe("failed");
    expect(readEventSyncState(database, rejected.eventId)).toBe("failed");

    // Conflicted -> conflict state + EXACTLY ONE conflict row with BOTH payloads
    // (outbox.ts:273 onwards). This is the key no-data-loss assertion.
    expect(readOutboxStatus(database, conflicted.eventId)).toBe("conflict");
    expect(readEventSyncState(database, conflicted.eventId)).toBe("conflict");

    const conflicts = listConflictRows(database);
    expect(conflicts).toHaveLength(1);
    const conflictRow = conflicts[0];
    if (!conflictRow) throw new Error("Expected one conflict row");
    expect(conflictRow.event_id).toBe(conflicted.eventId);
    expect(conflictRow.entity_id).toBe(conflicted.entityId);
    expect(conflictRow.status).toBe("open");
    expect(JSON.parse(conflictRow.local_payload_json)).toEqual({
      name: "Cliente Conflito",
    });
    expect(JSON.parse(conflictRow.remote_payload_json)).toEqual({
      name: "Cliente Conflito (nuvem)",
    });

    // getStatus reports 1 pending/failed (rejected) + 1 open conflict.
    const statusResponse = await app.request("/api/local/sync/status");
    const statusBody: unknown = await statusResponse.json();
    expect(statusBody).toMatchObject({
      pendingOutboxCount: 1,
      conflictCount: 1,
      state: "conflict",
    });

    database.close();
  });

  // GAP 2 [HIGH RISK]: resolve -> re-push round trip. resolved => retried & synced.
  it("re-pushes a resolved conflict so the retried event converges to synced", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    seedTenant(database);

    const conflicted = seedCustomer(database, "Cliente Conflito");

    const pushedEventIds: string[] = [];
    let conflictOnNextPush = true;
    const app = createLocalServer(createConfig(dbPath), database, {
      fetch: async (input, init) => {
        const url = String(input);

        if (url === "https://api.example.test/api/sync/push") {
          const events = parsePushEvents(init?.body);
          for (const event of events) pushedEventIds.push(event.eventId);

          if (conflictOnNextPush) {
            const [event] = events;
            if (!event) throw new Error("Expected an event in first push");
            return Response.json({
              accepted: [],
              rejected: [],
              conflicts: [
                {
                  id: "conflict-row-1",
                  eventId: event.eventId,
                  entityType: event.entityType,
                  entityId: event.entityId,
                  conflictType: "update_conflict",
                  status: "open",
                  localPayload: { name: "Cliente Conflito" },
                  remotePayload: { name: "Cliente Conflito (nuvem)" },
                },
              ],
              newCursor: "cursor-after-conflict",
            });
          }

          return Response.json({
            accepted: events.map((event) => ({
              eventId: event.eventId,
              remoteEntityId: 9100,
              remoteVersion: event.localVersion + 1,
              cloudEventId: `cloud:${event.eventId}`,
            })),
            rejected: [],
            conflicts: [],
            newCursor: "cursor-after-resync",
          });
        }

        if (url.startsWith("https://api.example.test/api/sync/conflicts/")) {
          return Response.json({
            data: { id: "conflict-row-1", resolvedAt: "2026-01-15T11:00:00Z" },
          });
        }

        if (url === "https://api.example.test/api/sync/bootstrap") {
          return bootstrapResponse();
        }

        if (url.startsWith("https://api.example.test/api/sync/pull")) {
          return emptyPullResponse();
        }

        throw new Error(`Unexpected URL ${url}`);
      },
    });

    // 1) First push lands the conflict.
    await app.request("/api/local/sync/retry", { method: "POST" });
    expect(readEventSyncState(database, conflicted.eventId)).toBe("conflict");
    expect(pushedEventIds).toEqual([conflicted.eventId]);

    // 2) Resolve as "resolved" -> event goes back to pending (conflicts.ts:71).
    conflictOnNextPush = false;
    const resolveResponse = await app.request(
      "/api/local/sync/conflicts/conflict-row-1/resolve",
      {
        method: "POST",
        body: JSON.stringify({ status: "resolved" }),
        headers: { "Content-Type": "application/json" },
      },
    );
    expect(resolveResponse.status).toBe(200);
    expect(readOutboxStatus(database, conflicted.eventId)).toBe("pending");
    expect(readEventSyncState(database, conflicted.eventId)).toBe("pending");

    // 3) Re-run sync -> the retried event IS re-sent and converges to synced.
    await app.request("/api/local/sync/retry", { method: "POST" });
    expect(pushedEventIds).toEqual([conflicted.eventId, conflicted.eventId]);
    expect(readOutboxStatus(database, conflicted.eventId)).toBe("synced");
    expect(readEventSyncState(database, conflicted.eventId)).toBe("synced");
    expect(readCustomerRemoteId(database, conflicted.entityId)).toBe(9100);

    database.close();
  });

  // GAP 2 (continued): ignored => closed (synced) without re-sending.
  it("closes an ignored conflict without re-sending the event", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    seedTenant(database);

    const conflicted = seedCustomer(database, "Cliente Ignorado");

    const pushedEventIds: string[] = [];
    let conflictOnNextPush = true;
    const app = createLocalServer(createConfig(dbPath), database, {
      fetch: async (input, init) => {
        const url = String(input);

        if (url === "https://api.example.test/api/sync/push") {
          const events = parsePushEvents(init?.body);
          for (const event of events) pushedEventIds.push(event.eventId);

          if (conflictOnNextPush) {
            const [event] = events;
            if (!event) throw new Error("Expected an event in first push");
            return Response.json({
              accepted: [],
              rejected: [],
              conflicts: [
                {
                  id: "conflict-row-2",
                  eventId: event.eventId,
                  entityType: event.entityType,
                  entityId: event.entityId,
                  conflictType: "update_conflict",
                  status: "open",
                  localPayload: { name: "Cliente Ignorado" },
                  remotePayload: { name: "Cliente Ignorado (nuvem)" },
                },
              ],
              newCursor: "cursor-after-conflict",
            });
          }

          return Response.json({
            accepted: events.map((event) => ({
              eventId: event.eventId,
              remoteEntityId: 9200,
              remoteVersion: event.localVersion + 1,
              cloudEventId: `cloud:${event.eventId}`,
            })),
            rejected: [],
            conflicts: [],
            newCursor: "cursor-after-resync",
          });
        }

        if (url.startsWith("https://api.example.test/api/sync/conflicts/")) {
          return Response.json({
            data: { id: "conflict-row-2", resolvedAt: "2026-01-15T11:00:00Z" },
          });
        }

        if (url === "https://api.example.test/api/sync/bootstrap") {
          return bootstrapResponse();
        }

        if (url.startsWith("https://api.example.test/api/sync/pull")) {
          return emptyPullResponse();
        }

        throw new Error(`Unexpected URL ${url}`);
      },
    });

    await app.request("/api/local/sync/retry", { method: "POST" });
    expect(pushedEventIds).toEqual([conflicted.eventId]);
    expect(readEventSyncState(database, conflicted.eventId)).toBe("conflict");

    // Resolve as "ignored" -> event is closed (synced) without re-queue
    // (conflicts.ts:77 else branch).
    conflictOnNextPush = false;
    const resolveResponse = await app.request(
      "/api/local/sync/conflicts/conflict-row-2/resolve",
      {
        method: "POST",
        body: JSON.stringify({ status: "ignored" }),
        headers: { "Content-Type": "application/json" },
      },
    );
    expect(resolveResponse.status).toBe(200);
    expect(readOutboxStatus(database, conflicted.eventId)).toBe("synced");
    expect(readEventSyncState(database, conflicted.eventId)).toBe("synced");

    // Re-run sync -> nothing re-sent (array stays at the single first push).
    await app.request("/api/local/sync/retry", { method: "POST" });
    expect(pushedEventIds).toEqual([conflicted.eventId]);
    expect(readCustomerRemoteId(database, conflicted.entityId)).toBeNull();

    database.close();
  });

  // GAP 3: an entity-level conflict carries NO eventId. applySyncPushResult must
  // still record a sync_conflicts row with event_id = NULL (outbox.ts:300-345),
  // and resolving it must reach the conflicted outbox event by matching
  // aggregate_id (conflicts.ts:108, the `@eventId IS NULL` branch).
  it("records and resolves an entity-level (eventId IS NULL) conflict via aggregate_id", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    seedTenant(database);

    const conflicted = seedCustomer(database, "Cliente Entidade");

    let pushCount = 0;
    const app = createLocalServer(createConfig(dbPath), database, {
      fetch: async (input, init) => {
        const url = String(input);

        if (url === "https://api.example.test/api/sync/push") {
          pushCount += 1;
          const events = parsePushEvents(init?.body);
          const [event] = events;
          if (!event) throw new Error("Expected an event in push");

          // Entity-level conflict: NO eventId, only entityId (aggregate id).
          return Response.json({
            accepted: [],
            rejected: [],
            conflicts: [
              {
                id: "entity-conflict-1",
                entityType: event.entityType,
                entityId: event.entityId,
                conflictType: "entity_conflict",
                status: "open",
                remotePayload: { name: "Cliente Entidade (nuvem)" },
              },
            ],
            newCursor: "cursor-after-conflict",
          });
        }

        if (url.startsWith("https://api.example.test/api/sync/conflicts/")) {
          return Response.json({
            data: {
              id: "entity-conflict-1",
              resolvedAt: "2026-01-15T11:00:00Z",
            },
          });
        }

        if (url === "https://api.example.test/api/sync/bootstrap") {
          return bootstrapResponse();
        }

        if (url.startsWith("https://api.example.test/api/sync/pull")) {
          return emptyPullResponse();
        }

        throw new Error(`Unexpected URL ${url}`);
      },
    });

    await app.request("/api/local/sync/retry", { method: "POST" });
    expect(pushCount).toBe(1);

    // The conflict row carries NO event_id but is keyed to the entity (aggregate id).
    const conflicts = listConflictRows(database);
    expect(conflicts).toHaveLength(1);
    const conflictRow = conflicts[0];
    if (!conflictRow) throw new Error("Expected one conflict row");
    expect(conflictRow.event_id).toBeNull();
    expect(conflictRow.entity_id).toBe(conflicted.entityId);

    // The entity-level branch does NOT touch the event row (only event-level
    // conflicts flip status); the event is still pending after the push.
    expect(readOutboxStatus(database, conflicted.eventId)).toBe("pending");
    expect(readEventSyncState(database, conflicted.eventId)).toBe("pending");

    // Put the event into 'conflict' state so moveConflictedEvents has a row that
    // must be matched purely by aggregate_id (there is no eventId on the conflict).
    database
      .prepare(
        "UPDATE domain_events SET sync_state = 'conflict' WHERE event_id = @eventId",
      )
      .run({ eventId: conflicted.eventId });
    database
      .prepare("UPDATE outbox SET status = 'conflict' WHERE event_id = @eventId")
      .run({ eventId: conflicted.eventId });

    // Resolve the entity-level conflict (eventId IS NULL). moveConflictedEvents
    // must locate the conflicted event by aggregate_id (conflicts.ts:108) and
    // move it back to pending for retry.
    const resolveResponse = await app.request(
      "/api/local/sync/conflicts/entity-conflict-1/resolve",
      {
        method: "POST",
        body: JSON.stringify({ status: "resolved" }),
        headers: { "Content-Type": "application/json" },
      },
    );
    expect(resolveResponse.status).toBe(200);

    // The entity-level resolve reached the conflicted event via aggregate_id.
    expect(readOutboxStatus(database, conflicted.eventId)).toBe("pending");
    expect(readEventSyncState(database, conflicted.eventId)).toBe("pending");

    database.close();
  });
});
