import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SYNC_PROTOCOL_VERSION,
  buildSyncUpdateRequiredResponse,
  desktopUpdateRequiredMessage,
  parseSyncCommand,
  syncCommandSupport,
  syncPushRequestSchema,
} from "@calibra-facil/contracts";
import {
  countDeadOutbox,
  openLocalDatabase,
  type LocalDatabase,
} from "@calibra-facil/local-db";
import type { LocalServerConfig } from "./bootstrap";
import { createLocalServerRuntime } from "./server";
import { createAssetStub, seedSyncedReferenceData } from "./test-support";

/**
 * The desktop side of the typed, versioned push protocol (REQ-SP-1, REQ-SP-6):
 * every push says which protocol and which app version it comes from, carries
 * only members of the protocol, and survives "update required" untouched.
 */
const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createTempDatabasePath() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-protocol-"));
  tempDirectories.push(directory);
  return path.join(directory, "calibra.sqlite");
}

function createConfig(
  dbPath: string,
  overrides: Partial<LocalServerConfig> = {},
): LocalServerConfig {
  return {
    host: "127.0.0.1",
    port: 4317,
    appVersion: "1.3.0",
    localServerVersion: "1.3.0",
    dbPath,
    storageRoot: path.join(path.dirname(dbPath), "files"),
    deviceId: "device-test",
    tenantId: null,
    organizationId: "org-1",
    unitId: 1,
    userId: "user-1",
    syncEnabled: true,
    bootstrapToken: null,
    cloudApiUrl: "https://cloud.example.test",
    cloudAuthToken: "cloud-token",
    cloudProxyToken: null,
    desktopRunId: "desktop-test-run",
    localServerRunId: "local-server-test-run",
    ...overrides,
  };
}

function seedBootstrapSnapshot(database: LocalDatabase) {
  database
    .prepare(
      `INSERT INTO tenant_snapshot (
         tenant_id, organization_id, active_unit_id, user_id,
         snapshot_json, pulled_at
       ) VALUES ('org-1', 'org-1', 1, 'user-1', '{}', '2026-01-01T00:00:00.000Z')`,
    )
    .run();
}

type PushBody = {
  protocolVersion?: unknown;
  desktopVersion?: unknown;
  events: unknown[];
};

function isPushBody(value: unknown): value is PushBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "events" in value &&
    Array.isArray(value.events)
  );
}

/** A cloud whose answer to the push is chosen per call, recording what it was sent. */
function createCloud(answerPush: (body: PushBody) => Response) {
  const pushes: PushBody[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/api/sync/push") {
      const body: unknown = JSON.parse(String(init?.body));
      if (!isPushBody(body)) throw new Error("not a push request");
      pushes.push(body);
      return answerPush(body);
    }
    if (url.pathname === "/api/sync/pull") {
      return Response.json({ cursor: "cursor-1", hasMore: false, events: [] });
    }
    return Response.json({ error: url.pathname }, { status: 500 });
  };
  return { pushes, fetchImpl };
}

function acceptAll(body: PushBody) {
  const eventIds = body.events.flatMap((event) =>
    typeof event === "object" &&
    event !== null &&
    "eventId" in event &&
    typeof event.eventId === "string"
      ? [event.eventId]
      : [],
  );
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

async function setup(
  answerPush: (body: PushBody) => Response,
  overrides: Partial<LocalServerConfig> = {},
) {
  const dbPath = createTempDatabasePath();
  const database = openLocalDatabase({ filePath: dbPath });
  seedBootstrapSnapshot(database);
  seedSyncedReferenceData(database, { organizationId: "org-1", unitId: 1 });
  const cloud = createCloud(answerPush);
  const runtime = createLocalServerRuntime(
    createConfig(dbPath, overrides),
    database,
    { fetch: cloud.fetchImpl },
  );
  const created = await createAssetStub(runtime.app, "Balanca Protocolo");
  expect(created.status, await created.clone().text()).toBe(201);
  return { database, cloud, runtime };
}

function outboxRows(database: LocalDatabase) {
  return database
    .prepare<
      [],
      { status: string; attempt_count: number; last_error: string | null }
    >("SELECT status, attempt_count, last_error FROM outbox")
    .all();
}

describe("the push request (REQ-SP-1)", () => {
  it("REQ-SP-1: says which protocol and which desktop version it comes from, and is a valid push request", async () => {
    const { cloud, runtime } = await setup(acceptAll);

    await runtime.syncRuntime.runPushSync();

    expect(cloud.pushes).toHaveLength(1);
    const [push] = cloud.pushes;
    expect(push?.protocolVersion).toBe(SYNC_PROTOCOL_VERSION);
    expect(push?.desktopVersion).toBe("1.3.0");
    expect(syncPushRequestSchema.safeParse(push).success).toBe(true);
  });

  it("REQ-SP-1: every event it pushes is a member of the protocol", async () => {
    const { cloud, runtime } = await setup(acceptAll);

    await runtime.syncRuntime.runPushSync();

    const events = cloud.pushes.flatMap((push) => push.events);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      const parsed = parseSyncCommand(event);
      expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
      if (parsed.ok) {
        expect(parsed.command.operation).toBe("create_local_asset");
      }
    }
  });
});

describe("the retired commands an older build may still hold (REQ-SP-1)", () => {
  // The six commands legacy-outbox-events.test.ts queues as an upgraded
  // desktop's leftovers, plus the other operations only an older build wrote.
  it.each([
    "create_local_non_conformance",
    "create_local_service_order_quote_draft",
    "create_local_service_order_delivery_document_draft",
    "create_local_job_draft",
    "create_local_customer",
    "update_local_customer_compliance",
    "update_local_customer",
    "update_local_asset",
    "save_local_service_order_execution_notes",
    "generate_local_certificate_pdf",
    "create_local_certificate_draft",
  ])(
    "REQ-SP-1: %s is an explicit legacy member of the protocol",
    (operation) => {
      expect(syncCommandSupport(operation)).toBe("legacy");
    },
  );
});

describe("update required (REQ-SP-6)", () => {
  const updateRequired = () =>
    Response.json(
      buildSyncUpdateRequiredResponse({
        minimumVersion: "1.4.0",
        desktopVersion: "1.3.0",
      }),
      { status: 426 },
    );

  it("REQ-SP-6 [HIGH RISK]: an update-required answer leaves every queued event exactly as it was: not failed, not backing off, not dead", async () => {
    const { database, runtime } = await setup(updateRequired);
    const before = outboxRows(database);
    expect(before.length).toBeGreaterThan(0);

    await expect(runtime.syncRuntime.runPushSync()).rejects.toThrow();

    expect(outboxRows(database)).toEqual(before);
    expect(outboxRows(database).every((row) => row.status === "pending")).toBe(
      true,
    );
    expect(countDeadOutbox(database)).toBe(0);
  });

  it("REQ-SP-6: the status says an update is required, in pt-BR, with the version", async () => {
    const { runtime } = await setup(updateRequired);

    await expect(runtime.syncRuntime.runPushSync()).rejects.toThrow(
      desktopUpdateRequiredMessage("1.4.0"),
    );

    expect(runtime.syncRuntime.getStatus()).toMatchObject({
      state: "error",
      updateRequiredVersion: "1.4.0",
      lastError: desktopUpdateRequiredMessage("1.4.0"),
      pendingOutboxCount: 1,
    });
    expect(desktopUpdateRequiredMessage("1.4.0")).toMatch(/Atualize/);
  });

  it("REQ-SP-6: after the update the same events go through and the notice clears", async () => {
    let updated = false;
    const { database, runtime } = await setup((body) =>
      updated ? acceptAll(body) : updateRequired(),
    );
    await expect(runtime.syncRuntime.runPushSync()).rejects.toThrow();
    const queued = outboxRows(database).length;

    updated = true;
    const status = await runtime.syncRuntime.runPushSync();

    expect(status.updateRequiredVersion ?? null).toBeNull();
    expect(status.pendingOutboxCount).toBe(0);
    expect(queued).toBeGreaterThan(0);
  });

  it("REQ-SP-6: a 426 that is not the cloud's typed answer (a proxy) is an ordinary failed push: it backs off", async () => {
    const { database, runtime } = await setup(
      () => new Response("Upgrade Required", { status: 426 }),
    );

    await expect(runtime.syncRuntime.runPushSync()).rejects.toThrow(
      "Cloud push failed with HTTP 426",
    );

    expect(outboxRows(database).every((row) => row.status === "failed")).toBe(
      true,
    );
    expect(
      runtime.syncRuntime.getStatus().updateRequiredVersion ?? null,
    ).toBeNull();
  });
});
