import os from "node:os";
import path from "node:path";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  SYNC_COMMAND_OPERATIONS,
  SYNC_COMMAND_SUPPORT,
  parseSyncCommand,
  type SyncBootstrapResponse,
} from "@calibra-facil/contracts";
import {
  applySyncBootstrap,
  applySyncPushResult,
  listPendingOutboxEvents,
  openLocalDatabase,
  resolveSyncConflict,
  saveLocalJobExecution,
} from "./index";
import { stableLocalNumericId } from "./ids";

// REQ-SP-5: the desktop's half of the stale-base check on a job execution.
//
// The base version of a job is its cloud `updatedAt` as the desktop last saw it:
// the value pulled with the job, moved forward each time the cloud accepts one
// of the desktop's own executions. Every job execution event carries it as
// `baseUpdatedAt` (in the envelope, lifted from the payload key of the same
// name), so the cloud can tell its own copy moved since.
//
// REQ-SP-1: every event the desktop's writers produce is a member of the typed
// push protocol.

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

type Database = ReturnType<typeof openLocalDatabase>;

const PULLED = "2026-01-15T10:00:00.000Z";
const ACCEPTED = "2026-01-15T12:30:00.000Z";
const CLOUD_MOVED = "2026-01-16T08:00:00.000Z";

function createDatabaseWithJob(): Database {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-job-base-"));
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
        createdAt: PULLED,
        updatedAt: PULLED,
      },
    ],
    serviceOrders: [],
  };
  applySyncBootstrap(database, bootstrap, "2026-01-15T11:00:00.000Z");
  return database;
}

const input = {
  routeId: "789",
  actorUserId: "user-1",
  deviceId: "device-1",
  data: { reading: 1 },
  calibrationLocationSnapshot: {
    type: "lab",
    addressText: "Laboratório",
    recordedAt: "2026-01-15T12:00:00.000Z",
    recordedBy: "user-1",
  },
};

function queuedJobEvents(database: Database) {
  return listPendingOutboxEvents(database, 50, {
    includeDeferred: true,
  }).filter((event) => event.entityType === "calibration_job");
}

function acceptJobEvent(
  database: Database,
  eventId: string,
  updatedAt: string,
) {
  applySyncPushResult(database, {
    accepted: [
      {
        eventId,
        remoteEntityId: 789,
        remoteEntity: {
          id: 789,
          jobId: "J-789",
          status: "IN_PROGRESS",
          updatedAt,
        },
        remoteVersion: 1,
        cloudEventId: `cloud:${eventId}`,
      },
    ],
    rejected: [],
    conflicts: [],
    newCursor: "cursor-accept",
  });
}

function localUpdatedAt(database: Database) {
  return database
    .prepare<
      [],
      { updated_at: string }
    >("SELECT updated_at FROM calibration_jobs WHERE id = 'job:789'")
    .get()?.updated_at;
}

describe("base version of a job execution (REQ-SP-5)", () => {
  it("REQ-SP-5: the first execution of a pulled job carries the cloud updatedAt it was pulled with", () => {
    const database = createDatabaseWithJob();

    saveLocalJobExecution(database, input);

    const [event] = queuedJobEvents(database);
    expect(event?.operation).toBe("save_local_execution");
    expect(event?.baseUpdatedAt).toBe(PULLED);
    database.close();
  });

  it("REQ-SP-5: further executions queued before a sync keep the base the first was made against, not the previous local save", () => {
    const database = createDatabaseWithJob();

    saveLocalJobExecution(database, input);
    saveLocalJobExecution(database, { ...input, data: { reading: 2 } });
    saveLocalJobExecution(database, {
      ...input,
      data: { reading: 3 },
      requireResults: true,
    });

    const events = queuedJobEvents(database);
    expect(events.map((event) => event.operation)).toEqual([
      "save_local_execution",
      "save_local_execution",
      "submit_local_execution",
    ]);
    expect(events.map((event) => event.baseUpdatedAt)).toEqual([
      PULLED,
      PULLED,
      PULLED,
    ]);
    database.close();
  });

  it("REQ-SP-5: when the cloud accepts an execution, the base of the ones still queued and of the next edit moves to the updatedAt it answers", () => {
    const database = createDatabaseWithJob();
    saveLocalJobExecution(database, input);
    saveLocalJobExecution(database, { ...input, data: { reading: 2 } });
    const [first] = queuedJobEvents(database);
    if (!first) throw new Error("expected a queued event");

    acceptJobEvent(database, first.eventId, ACCEPTED);

    const remaining = queuedJobEvents(database);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.baseUpdatedAt).toBe(ACCEPTED);
    expect(localUpdatedAt(database)).toBe(ACCEPTED);

    // Once everything is accepted, the next edit is made against the accepted version.
    const [second] = remaining;
    if (!second) throw new Error("expected a second event");
    acceptJobEvent(database, second.eventId, "2026-01-15T13:00:00.000Z");
    saveLocalJobExecution(database, { ...input, data: { reading: 3 } });
    expect(queuedJobEvents(database)[0]?.baseUpdatedAt).toBe(
      "2026-01-15T13:00:00.000Z",
    );
    database.close();
  });

  it("REQ-SP-5: an accept answer without updatedAt (an older cloud) leaves the base alone", () => {
    const database = createDatabaseWithJob();
    saveLocalJobExecution(database, input);
    saveLocalJobExecution(database, { ...input, data: { reading: 2 } });
    const [first] = queuedJobEvents(database);
    if (!first) throw new Error("expected a queued event");

    applySyncPushResult(database, {
      accepted: [
        {
          eventId: first.eventId,
          remoteEntityId: 789,
          remoteEntity: { id: 789, jobId: "J-789", status: "IN_PROGRESS" },
          remoteVersion: 1,
          cloudEventId: `cloud:${first.eventId}`,
        },
      ],
      rejected: [],
      conflicts: [],
    });

    expect(queuedJobEvents(database)[0]?.baseUpdatedAt).toBe(PULLED);
    database.close();
  });

  it("REQ-SP-5: resolving a stale-base conflict by keeping the local execution re-bases the queued event on the cloud version the technician reviewed, so it is not refused again for the same change", () => {
    const database = createDatabaseWithJob();
    saveLocalJobExecution(database, input);
    const [event] = queuedJobEvents(database);
    if (!event) throw new Error("expected a queued event");
    applySyncPushResult(database, {
      accepted: [],
      rejected: [],
      conflicts: [
        {
          id: "conflict-1",
          eventId: event.eventId,
          entityType: "calibration_job",
          entityId: event.entityId,
          conflictType: "concurrent_update",
          status: "open",
          localPayload: event.payload,
          remotePayload: {
            entity: "calibration_job",
            id: 789,
            updatedAt: CLOUD_MOVED,
            baseUpdatedAt: PULLED,
          },
        },
      ],
    });
    expect(queuedJobEvents(database)).toEqual([]);

    resolveSyncConflict(database, "conflict-1", "resolved");

    const [requeued] = queuedJobEvents(database);
    expect(requeued?.eventId).toBe(event.eventId);
    expect(requeued?.baseUpdatedAt).toBe(CLOUD_MOVED);
    database.close();
  });

  it("REQ-SP-5: a job that was never pulled (created offline, no cloud id) carries no base", () => {
    const database = createDatabaseWithJob();
    database
      .prepare(
        "UPDATE calibration_jobs SET remote_id = NULL WHERE id = 'job:789'",
      )
      .run();

    saveLocalJobExecution(database, {
      ...input,
      routeId: String(stableLocalNumericId("job:789")),
    });

    expect(queuedJobEvents(database)[0]?.baseUpdatedAt).toBeNull();
    database.close();
  });
});

describe("the desktop's events are members of the typed push protocol (REQ-SP-1)", () => {
  it("REQ-SP-1: a job save and a job submit, as the real writer queues them, parse as current members", () => {
    const database = createDatabaseWithJob();
    saveLocalJobExecution(database, input);
    saveLocalJobExecution(database, { ...input, requireResults: true });

    const events = queuedJobEvents(database);
    expect(events).toHaveLength(2);
    for (const event of events) {
      const parsed = parseSyncCommand({
        ...event,
        organizationId: "org-1",
        unitId: 1,
        actorUserId: event.actorUserId ?? "user-1",
      });
      expect(parsed.ok, event.operation).toBe(true);
      expect(
        SYNC_COMMAND_SUPPORT[
          event.operation === "submit_local_execution"
            ? "submit_local_execution"
            : "save_local_execution"
        ],
      ).toBe("current");
    }
    database.close();
  });

  it("REQ-SP-1: every operation a local-db writer names is a member of the protocol, and every `current` member is named by one", () => {
    const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
    const writerSource = readdirSync(sourceDirectory)
      .filter((name) => name.endsWith(".ts") && !name.includes(".test."))
      .map((name) => readFileSync(path.join(sourceDirectory, name), "utf8"))
      .join("\n");

    const named = new Set(
      [
        ...writerSource.matchAll(/operation:\s*"([a-z][a-z0-9_]+)"/g),
        ...writerSource.matchAll(
          /"((?:create|update|save|submit)_local_[a-z_]+)"/g,
        ),
      ].flatMap((match) => (match[1] ? [match[1]] : [])),
    );

    const members = new Set<string>(SYNC_COMMAND_OPERATIONS);
    expect([...named].filter((name) => !members.has(name))).toEqual([]);
    const current = Object.entries(SYNC_COMMAND_SUPPORT)
      .filter(([, support]) => support === "current")
      .map(([operation]) => operation);
    expect(current.filter((operation) => !named.has(operation))).toEqual([]);
  });
});
