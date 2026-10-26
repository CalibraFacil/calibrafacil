import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  SYNC_CHANGE_SEQ_PROTOCOL_VERSION,
  SYNC_PROTOCOL_VERSION,
  SYNC_PROTOCOL_UNSUPPORTED_CODE,
  buildSyncResyncRequiredResponse,
} from "@calibra-facil/contracts";
import {
  applySyncBootstrap,
  createLocalCustomer,
  listPendingOutboxEvents,
  getBootstrapPageToken,
  getSyncCursor,
  hasIncompleteBootstrap,
  openLocalDatabase,
} from "@calibra-facil/local-db";
import type { LocalServerConfig } from "./bootstrap";
import { createLocalSyncRuntime } from "./sync";

// The desktop side of protocol 3: the paged bootstrap and its resumption (REQ-CS-3), the
// pull that states its protocol (REQ-CS-1/4), and the typed "bootstrap again" (REQ-CS-5).

const tempDirectories: string[] = [];

function createTempDatabasePath() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-cs-test-"));
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
    cloudApiUrl: "https://api.example.test",
    cloudAuthToken: null,
    cloudProxyToken: null,
    desktopRunId: "desktop-test-run",
    localServerRunId: "local-server-test-run",
  };
}

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

const EMPTY = {
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

const customer = (id: number) => ({
  id,
  name: `Cliente ${id}`,
  taxId: null,
  email: null,
  phone: null,
  address: null,
  compliance: null,
  updatedAt: "2026-01-15T10:00:00.000Z",
});

function pageBody(
  rows: Record<string, unknown[]>,
  nextToken: string | null,
  syncCursor = "v3|50|0",
) {
  return {
    ...HEADER,
    ...EMPTY,
    ...rows,
    syncCursor,
    page: { nextToken, rowCount: 1 },
  };
}

type Recorded = { method: string; url: URL; body: unknown };

/** A cloud of protocol 3 that serves the bootstrap in `pages` and an empty pull. */
function cloudOfProtocol3(options: {
  pages: Array<ReturnType<typeof pageBody>>;
  failOnPage?: number;
  pull?: (url: URL) => Response;
}) {
  const requests: Recorded[] = [];
  let pageIndex = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const body: unknown =
      typeof init?.body === "string" ? JSON.parse(init.body) : null;
    requests.push({ method: init?.method ?? "GET", url, body });

    if (url.pathname === "/api/sync/push") {
      return Response.json({ accepted: [], rejected: [], conflicts: [] });
    }
    if (url.pathname === "/api/sync/bootstrap") {
      const requestedToken =
        typeof body === "object" && body !== null && "pageToken" in body
          ? body.pageToken
          : null;
      // A page is addressed by its token: the first has none.
      const index =
        requestedToken === null
          ? 0
          : options.pages.findIndex(
              (candidate, position) =>
                options.pages[position - 1]?.page.nextToken === requestedToken,
            );
      if (index < 0)
        return Response.json({ error: "bad token" }, { status: 400 });
      if (options.failOnPage === index) {
        options.failOnPage = undefined;
        throw new Error("network down");
      }
      pageIndex = index;
      return Response.json(options.pages[pageIndex]);
    }
    if (url.pathname === "/api/sync/pull") {
      return (
        options.pull?.(url) ??
        Response.json({ cursor: "v3|60|0", hasMore: false, events: [] })
      );
    }
    return Response.json(
      { error: `Unexpected ${url.pathname}` },
      { status: 500 },
    );
  };
  return { fetchImpl, requests };
}

function pageTokenOf(body: unknown) {
  return typeof body === "object" && body !== null && "pageToken" in body
    ? body.pageToken
    : undefined;
}

function bootstrapRequests(requests: Recorded[]) {
  return requests.filter(
    (request) => request.url.pathname === "/api/sync/bootstrap",
  );
}

describe("the paged bootstrap on the desktop", () => {
  it("REQ-CS-3: asks for pages with protocolVersion 3, follows the tokens and sets the pull cursor only after the last", async () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    const cloud = cloudOfProtocol3({
      pages: [
        pageBody({ customers: [customer(1)] }, "tok-1"),
        pageBody({ customers: [customer(2)] }, "tok-2"),
        pageBody({ customers: [customer(3)] }, null),
      ],
    });
    const runtime = createLocalSyncRuntime(
      createConfig(createTempDatabasePath()),
      database,
      { fetch: cloud.fetchImpl },
    );

    await runtime.runInitialSync();

    const asked = bootstrapRequests(cloud.requests);
    expect(asked.map((request) => request.body)).toEqual([
      { protocolVersion: SYNC_CHANGE_SEQ_PROTOCOL_VERSION, pageToken: null },
      { protocolVersion: SYNC_CHANGE_SEQ_PROTOCOL_VERSION, pageToken: "tok-1" },
      { protocolVersion: SYNC_CHANGE_SEQ_PROTOCOL_VERSION, pageToken: "tok-2" },
    ]);
    const customers = database
      .prepare<[], { total: number }>("SELECT COUNT(*) AS total FROM customers")
      .get();
    expect(customers?.total).toBe(3);
    expect(hasIncompleteBootstrap(database)).toBe(false);
    // The pull ran after the bootstrap, from the cursor the last page handed out.
    const pull = cloud.requests.find(
      (request) => request.url.pathname === "/api/sync/pull",
    );
    expect(pull?.url.searchParams.get("protocolVersion")).toBe(
      String(SYNC_CHANGE_SEQ_PROTOCOL_VERSION),
    );
    expect(pull?.url.searchParams.get("cursor")).toBe("v3|50|0");
    database.close();
  });

  it("REQ-CS-3: a bootstrap cut short resumes from the last completed page, not from the first", async () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    const cloud = cloudOfProtocol3({
      pages: [
        pageBody({ customers: [customer(1)] }, "tok-1"),
        pageBody({ customers: [customer(2)] }, "tok-2"),
        pageBody({ customers: [customer(3)] }, null),
      ],
      failOnPage: 2,
    });
    const runtime = createLocalSyncRuntime(
      createConfig(createTempDatabasePath()),
      database,
      { fetch: cloud.fetchImpl },
    );

    await expect(runtime.runInitialSync()).rejects.toThrow("network down");
    expect(getBootstrapPageToken(database)).toBe("tok-2");
    expect(getSyncCursor(database)).toBe(null);
    expect(hasIncompleteBootstrap(database)).toBe(true);
    const before = bootstrapRequests(cloud.requests).length;
    expect(before).toBe(3);

    // The next run (the scheduler's push sync, not only the initial one) resumes.
    await runtime.runPushSync();

    const resumed = bootstrapRequests(cloud.requests).slice(before);
    expect(resumed.map((request) => request.body)).toEqual([
      { protocolVersion: SYNC_CHANGE_SEQ_PROTOCOL_VERSION, pageToken: "tok-2" },
    ]);
    const customers = database
      .prepare<[], { total: number }>("SELECT COUNT(*) AS total FROM customers")
      .get();
    expect(customers?.total).toBe(3);
    expect(hasIncompleteBootstrap(database)).toBe(false);
    expect(getSyncCursor(database)).toBe("v3|60|0");
    database.close();
  });

  it("REQ-CS-3: a page token the cloud refuses restarts the bootstrap from the first page, once", async () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    const cloud = cloudOfProtocol3({
      pages: [pageBody({ customers: [customer(1)] }, null)],
    });
    // A bootstrap left behind by another build: its token means nothing to this cloud.
    database
      .prepare(
        "INSERT INTO sync_cursors (scope, cursor, updated_at) VALUES ('bootstrap-page', 'stale', '2026-01-01T00:00:00.000Z')",
      )
      .run();
    const runtime = createLocalSyncRuntime(
      createConfig(createTempDatabasePath()),
      database,
      { fetch: cloud.fetchImpl },
    );

    await runtime.runInitialSync();

    expect(
      bootstrapRequests(cloud.requests).map((request) =>
        pageTokenOf(request.body),
      ),
    ).toEqual(["stale", null]);
    expect(hasIncompleteBootstrap(database)).toBe(false);
    database.close();
  });

  it("REQ-CS-4: a cloud that predates protocol 3 answers the whole bootstrap at once, and the desktop applies it", async () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    const whole = {
      ...HEADER,
      ...EMPTY,
      customers: [customer(1), customer(2)],
      syncCursor: "2026-01-15T10:00:00.000Z",
    };
    const requests: Recorded[] = [];
    const runtime = createLocalSyncRuntime(
      createConfig(createTempDatabasePath()),
      database,
      {
        fetch: async (input, init) => {
          const url = new URL(String(input));
          requests.push({
            method: init?.method ?? "GET",
            url,
            body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
          });
          if (url.pathname === "/api/sync/bootstrap")
            return Response.json(whole);
          if (url.pathname === "/api/sync/pull") {
            return Response.json({
              cursor: "2026-01-15T10:00:00.000Z",
              hasMore: false,
              events: [],
            });
          }
          return Response.json({ accepted: [], rejected: [], conflicts: [] });
        },
      },
    );

    await runtime.runInitialSync();

    expect(bootstrapRequests(requests).length).toBe(1);
    const customers = database
      .prepare<[], { total: number }>("SELECT COUNT(*) AS total FROM customers")
      .get();
    expect(customers?.total).toBe(2);
    expect(getSyncCursor(database)).toBe("2026-01-15T10:00:00.000Z");
    database.close();
  });
});

describe("the pull on the desktop", () => {
  it("REQ-CS-5: when the cloud cannot serve the cursor (typed resync), the desktop bootstraps again and pulls once more", async () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    let pulls = 0;
    const cloud = cloudOfProtocol3({
      pages: [pageBody({ customers: [customer(1)] }, null, "v3|90|0")],
      pull: () => {
        pulls += 1;
        return pulls === 1
          ? Response.json(buildSyncResyncRequiredResponse("cursor_purged"), {
              status: 409,
            })
          : Response.json({ cursor: "v3|95|0", hasMore: false, events: [] });
      },
    });
    const runtime = createLocalSyncRuntime(
      createConfig(createTempDatabasePath()),
      database,
      { fetch: cloud.fetchImpl },
    );

    await runtime.runInitialSync();

    expect(pulls).toBe(2);
    expect(bootstrapRequests(cloud.requests).length).toBe(2);
    expect(getSyncCursor(database)).toBe("v3|95|0");
    const secondPull = cloud.requests
      .filter((request) => request.url.pathname === "/api/sync/pull")
      .at(1);
    expect(secondPull?.url.searchParams.get("cursor")).toBe("v3|90|0");
    database.close();
  });

  it("REQ-CS-5: a cloud that keeps asking for a bootstrap does not loop: the run fails and the next one tries again", async () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    const cloud = cloudOfProtocol3({
      pages: [pageBody({ customers: [customer(1)] }, null)],
      pull: () =>
        Response.json(buildSyncResyncRequiredResponse("cursor_format"), {
          status: 409,
        }),
    });
    const runtime = createLocalSyncRuntime(
      createConfig(createTempDatabasePath()),
      database,
      { fetch: cloud.fetchImpl },
    );

    await expect(runtime.runInitialSync()).rejects.toThrow(
      "Cloud asked for a new bootstrap",
    );
    expect(
      cloud.requests.filter(
        (request) => request.url.pathname === "/api/sync/pull",
      ).length,
    ).toBe(2);
    database.close();
  });

  it("REQ-CS-4: a pull against a legacy cursor is not retried with another protocol: the desktop always states protocol 3", async () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    const cloud = cloudOfProtocol3({
      pages: [pageBody({ customers: [customer(1)] }, null)],
    });
    const runtime = createLocalSyncRuntime(
      createConfig(createTempDatabasePath()),
      database,
      { fetch: cloud.fetchImpl },
    );
    await runtime.runInitialSync();
    await runtime.runPushSync();

    for (const request of cloud.requests.filter(
      (candidate) => candidate.url.pathname === "/api/sync/pull",
    )) {
      expect(request.url.searchParams.get("protocolVersion")).toBe("3");
    }
    database.close();
  });
});

describe("a protocol 3 desktop against a cloud that predates protocol 3", () => {
  it("REQ-CS-4: the push refused for its protocol number is sent again with the one the cloud speaks; queued events sync and the pull still runs", async () => {
    const database = openLocalDatabase({ filePath: createTempDatabasePath() });
    const cloudApiUrl = "https://older-cloud.example.test";
    const pushedVersions: unknown[] = [];
    let pulled = 0;
    const runtime = createLocalSyncRuntime(
      { ...createConfig(createTempDatabasePath()), cloudApiUrl },
      database,
      {
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === "/api/sync/push") {
            const body = JSON.parse(String(init?.body));
            pushedVersions.push(body.protocolVersion);
            // A cloud of protocol 2 refuses what it does not know.
            if (body.protocolVersion > 2) {
              return Response.json(
                {
                  code: SYNC_PROTOCOL_UNSUPPORTED_CODE,
                  supportedProtocolVersion: 2,
                  message: "newer than the cloud supports",
                },
                { status: 400 },
              );
            }
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
            });
          }
          if (url.pathname === "/api/sync/pull") {
            pulled += 1;
            return Response.json({
              cursor: "2026-01-15T10:00:00.000Z",
              hasMore: false,
              events: [],
            });
          }
          throw new Error(`Unexpected URL ${url}`);
        },
      },
    );
    applySyncBootstrap(database, {
      ...HEADER,
      ...EMPTY,
      syncCursor: "2026-01-01T00:00:00.000Z",
    });
    createLocalCustomer(database, {
      organizationId: "org-1",
      unitId: 1,
      name: "Cliente Offline",
      email: "offline@example.com",
      actorUserId: "user-1",
      deviceId: "device-test",
    });
    expect(listPendingOutboxEvents(database, 50).length).toBe(1);

    await runtime.runPushSync();

    expect(pushedVersions).toEqual([SYNC_PROTOCOL_VERSION, 2]);
    expect(
      listPendingOutboxEvents(database, 50, { includeDeferred: true }).length,
    ).toBe(0);
    expect(pulled).toBe(1);

    // The cloud's protocol is remembered: the next push does not ask twice.
    createLocalCustomer(database, {
      organizationId: "org-1",
      unitId: 1,
      name: "Outro Cliente",
      email: "other@example.com",
      actorUserId: "user-1",
      deviceId: "device-test",
    });
    await runtime.runPushSync();
    expect(pushedVersions).toEqual([SYNC_PROTOCOL_VERSION, 2, 2]);
    database.close();
  });
});
