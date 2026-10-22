import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applySyncBootstrap,
  openLocalDatabase,
  type LocalDatabase,
} from "@calibra-facil/local-db";
import type { LocalServerConfig } from "./bootstrap";
import { createLocalSyncRuntime } from "./sync";

/**
 * Q13 retired these commands from offline mode, but a desktop upgraded from an
 * earlier build can still hold their events in the outbox. The sync push must
 * keep draining them: accepted rows are adopted exactly as before, refused ones
 * leave the queue through the dead-event path, and in neither case may they
 * starve the field-capture and intake events queued behind them.
 */
const tempDirectories: string[] = [];

function createTempDatabasePath() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-legacy-"));
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
    port: 4319,
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

const NOW = "2026-02-01T10:00:00.000Z";

/** The retired commands, with the aggregate each one wrote to. */
const LEGACY_COMMANDS = [
  { kind: "non_conformance", operation: "create_local_non_conformance" },
  {
    kind: "service_order_quote",
    operation: "create_local_service_order_quote_draft",
  },
  {
    kind: "service_order_delivery_document",
    operation: "create_local_service_order_delivery_document_draft",
  },
  { kind: "calibration_job", operation: "create_local_job_draft" },
  { kind: "customer", operation: "create_local_customer" },
  { kind: "customer", operation: "update_local_customer_compliance" },
] as const;

type QueuedEvent = {
  eventId: string;
  aggregateKind: string;
  aggregateId: string;
  operation: string;
};

let sequence = 0;

/** Writes a domain event and its outbox row exactly as the old writers did. */
function queueEvent(
  database: LocalDatabase,
  input: { kind: string; aggregateId: string; operation: string },
): QueuedEvent {
  sequence += 1;
  const eventId = `event:legacy-${sequence}`;
  // Strictly increasing so the push order is the queue order.
  const occurredAt = new Date(Date.parse(NOW) + sequence * 1000).toISOString();
  const payload = JSON.stringify({ legacy: true, n: sequence });

  database
    .prepare(
      `
INSERT INTO domain_events (
  event_id, aggregate_kind, aggregate_id, aggregate_version, event_type,
  payload_json, metadata_json, actor_user_id, device_id, occurred_at, sync_state
) VALUES (
  @eventId, @kind, @aggregateId, 0, @operation,
  @payload, '{}', 'user-1', 'device-test', @occurredAt, 'pending'
)
`,
    )
    .run({ eventId, ...input, payload, occurredAt });
  database
    .prepare(
      `
INSERT INTO outbox (
  id, event_id, operation, payload_json, idempotency_key, status, created_at
) VALUES (
  @id, @eventId, @operation, @payload, @idempotencyKey, 'pending', @occurredAt
)
`,
    )
    .run({
      id: `outbox:legacy-${sequence}`,
      eventId,
      operation: input.operation,
      payload,
      idempotencyKey: `local:${eventId}`,
      occurredAt,
    });

  return {
    eventId,
    aggregateKind: input.kind,
    aggregateId: input.aggregateId,
    operation: input.operation,
  };
}

/** The local rows the retired writers left behind, awaiting adoption. */
function seedLegacyRows(database: LocalDatabase) {
  database
    .prepare(
      `
INSERT INTO service_orders (
  id, remote_id, service_order_number, organization_id, unit_id, customer_id,
  asset_id, intake_type, status, priority, claimed_defect, intake_condition,
  delivery_method, opened_at, updated_at, sync_state
) VALUES (
  'service-order:1', 987, 'OS-2026-0007', 'org-1', 1, 'customer:legacy',
  'asset:legacy', 'counter', 'awaiting_tech_evaluation', 'normal', 'Nao liga',
  'Sem danos', 'pickup_at_lab', @now, @now, 'synced'
)
`,
    )
    .run({ now: NOW });
  database
    .prepare(
      `
INSERT INTO non_conformances (
  id, nc_number, organization_id, unit_id, type, description, detected_at,
  status, created_at, updated_at, sync_state
) VALUES (
  'nc:legacy', 'LOCAL-NC-2026-0001', 'org-1', 1, 'equipment',
  'Instrumento com desvio', @now, 'open', @now, @now, 'local'
)
`,
    )
    .run({ now: NOW });
  database
    .prepare(
      `
INSERT INTO service_order_quotes (
  id, service_order_id, quote_number, version, status, created_at, updated_at,
  sync_state
) VALUES ('quote:legacy', 'service-order:1', 'OS-2026-0007/ORC', 1, 'draft',
  @now, @now, 'local')
`,
    )
    .run({ now: NOW });
  database
    .prepare(
      `
INSERT INTO service_order_delivery_documents (
  id, service_order_id, document_number, version, created_at, sync_state
) VALUES ('document:legacy', 'service-order:1', 'OS-2026-0007/ENT', 1, @now,
  'local')
`,
    )
    .run({ now: NOW });
  database
    .prepare(
      `
INSERT INTO calibration_jobs (
  id, job_id, organization_id, unit_id, customer_id, asset_id, service_id,
  method_snapshot_json, asset_snapshot_json, status, created_at, updated_at,
  sync_state
) VALUES ('job:legacy', 'LOCAL-0001', 'org-1', 1, 'customer:legacy',
  'asset:legacy', 'service:legacy', '{}', '{}', 'DRAFT', @now, @now, 'local')
`,
    )
    .run({ now: NOW });
  database
    .prepare(
      `
INSERT INTO customers (
  id, organization_id, unit_id, name, updated_at, sync_state
) VALUES ('customer:legacy', 'org-1', 1, 'Cliente legado', @now, 'local')
`,
    )
    .run({ now: NOW });
}

function queueLegacyCommands(database: LocalDatabase) {
  const aggregateIds: Record<string, string> = {
    non_conformance: "nc:legacy",
    service_order_quote: "quote:legacy",
    service_order_delivery_document: "document:legacy",
    calibration_job: "job:legacy",
    customer: "customer:legacy",
  };

  return LEGACY_COMMANDS.map((command) =>
    queueEvent(database, {
      kind: command.kind,
      aggregateId: aggregateIds[command.kind] ?? "",
      operation: command.operation,
    }),
  );
}

type PushedEvent = { eventId: string; operation: string };

function readPushedEvents(body: BodyInit | null | undefined): PushedEvent[] {
  const parsed: unknown = JSON.parse(String(body));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const events = Object.fromEntries(Object.entries(parsed)).events;
  if (!Array.isArray(events)) return [];

  return events.flatMap((event): PushedEvent[] => {
    if (!event || typeof event !== "object" || Array.isArray(event)) return [];
    const fields = Object.fromEntries(Object.entries(event));
    return typeof fields.eventId === "string" &&
      typeof fields.operation === "string"
      ? [{ eventId: fields.eventId, operation: fields.operation }]
      : [];
  });
}

type PushAnswer =
  | { accepted: true; remoteEntityId?: number; remoteEntity?: unknown }
  | { accepted: false; code: string };

/** A cloud that answers each pushed event through `answer`, and records pushes. */
function mockCloud(answer: (event: PushedEvent) => PushAnswer) {
  const pushes: PushedEvent[][] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://api.example.test/api/sync/push") {
      const events = readPushedEvents(init?.body);
      pushes.push(events);
      const answers = events.map((event) => ({ event, answer: answer(event) }));
      return Response.json({
        accepted: answers.flatMap(({ event, answer: result }) =>
          result.accepted
            ? [
                {
                  eventId: event.eventId,
                  remoteEntityId: result.remoteEntityId,
                  remoteEntity: result.remoteEntity,
                  remoteVersion: 1,
                  cloudEventId: `cloud:${event.eventId}`,
                },
              ]
            : [],
        ),
        rejected: answers.flatMap(({ event, answer: result }) =>
          result.accepted
            ? []
            : [
                {
                  eventId: event.eventId,
                  code: result.code,
                  reason: `refused: ${result.code}`,
                },
              ],
        ),
        conflicts: [],
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
  };

  return { pushes, fetchImpl };
}

function outboxStatuses(database: LocalDatabase) {
  return Object.fromEntries(
    database
      .prepare<
        [],
        { event_id: string; status: string; error_code: string | null }
      >("SELECT event_id, status, error_code FROM outbox")
      .all()
      .map((row) => [row.event_id, row]),
  );
}

describe("legacy outbox events from before Q13 still drain", () => {
  it("adopts the cloud's answer for every retired command when the push is accepted", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    seedTenant(database);
    seedLegacyRows(database);
    const legacy = queueLegacyCommands(database);
    // Work the narrowed offline mode still produces, queued behind them.
    const current = queueEvent(database, {
      kind: "asset",
      aggregateId: "asset:current",
      operation: "create_local_asset",
    });

    const cloud = mockCloud((event) => {
      switch (event.operation) {
        case "create_local_non_conformance":
          return {
            accepted: true,
            remoteEntityId: 901,
            remoteEntity: { ncNumber: "NC-2026-0001" },
          };
        case "create_local_service_order_quote_draft":
          return { accepted: true, remoteEntityId: 902 };
        case "create_local_service_order_delivery_document_draft":
          return {
            accepted: true,
            remoteEntityId: 903,
            remoteEntity: { issuedAt: "2026-02-02T09:00:00.000Z" },
          };
        case "create_local_job_draft":
          return {
            accepted: true,
            remoteEntityId: 904,
            remoteEntity: { jobId: "CAL-2026-0007" },
          };
        case "create_local_customer":
          return { accepted: true, remoteEntityId: 905 };
        default:
          return { accepted: true };
      }
    });
    const runtime = createLocalSyncRuntime(createConfig(dbPath), database, {
      fetch: cloud.fetchImpl,
    });

    const status = await runtime.runPushSync();

    // One push carried all of it, legacy first.
    expect(cloud.pushes).toHaveLength(1);
    expect(cloud.pushes[0]?.map((event) => event.eventId)).toEqual([
      ...legacy.map((event) => event.eventId),
      current.eventId,
    ]);
    expect(status).toMatchObject({ pendingOutboxCount: 0, deadOutboxCount: 0 });
    expect(
      Object.values(outboxStatuses(database)).every(
        (row) => row.status === "synced",
      ),
    ).toBe(true);

    // The accepted rows were adopted, not left as local orphans.
    const adopted = database
      .prepare(
        `
SELECT
  (SELECT remote_id || ':' || nc_number || ':' || sync_state
     FROM non_conformances WHERE id = 'nc:legacy') AS nc,
  (SELECT remote_id || ':' || sync_state
     FROM service_order_quotes WHERE id = 'quote:legacy') AS quote,
  (SELECT remote_id || ':' || issued_at || ':' || sync_state
     FROM service_order_delivery_documents WHERE id = 'document:legacy') AS document,
  (SELECT remote_id || ':' || job_id || ':' || sync_state
     FROM calibration_jobs WHERE id = 'job:legacy') AS job,
  (SELECT remote_id || ':' || sync_state
     FROM customers WHERE id = 'customer:legacy') AS customer
`,
      )
      .get();
    expect(adopted).toEqual({
      nc: "901:NC-2026-0001:synced",
      quote: "902:synced",
      document: "903:2026-02-02T09:00:00.000Z:synced",
      job: "904:CAL-2026-0007:synced",
      customer: "905:synced",
    });

    database.close();
  });

  it("parks refused retired commands as dead events without starving newer work", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    seedTenant(database);
    seedLegacyRows(database);
    // More dead-on-arrival events than one push page (50), so a refusal that
    // stayed eligible would crowd the newer event out of every page.
    const legacy = [
      ...queueLegacyCommands(database),
      ...Array.from({ length: 55 }, (_, index) =>
        queueEvent(database, {
          kind: "non_conformance",
          aggregateId: `nc:extra-${index}`,
          operation: "create_local_non_conformance",
        }),
      ),
    ];
    const current = queueEvent(database, {
      kind: "asset",
      aggregateId: "asset:current",
      operation: "create_local_asset",
    });
    const legacyOperations = new Set<string>(
      LEGACY_COMMANDS.map((command) => command.operation),
    );

    const cloud = mockCloud((event) =>
      legacyOperations.has(event.operation)
        ? { accepted: false, code: "UNSUPPORTED_SYNC_OPERATION" }
        : { accepted: true },
    );
    const runtime = createLocalSyncRuntime(createConfig(dbPath), database, {
      fetch: cloud.fetchImpl,
    });

    let status = await runtime.runPushSync();
    // The queue drains in a bounded number of pages, never forever.
    for (let page = 0; page < 5 && status.pendingOutboxCount > 0; page += 1) {
      status = await runtime.runPushSync();
    }

    const statuses = outboxStatuses(database);
    expect(statuses[current.eventId]?.status).toBe("synced");
    for (const event of legacy) {
      expect(statuses[event.eventId], event.operation).toMatchObject({
        status: "dead",
        error_code: "UNSUPPORTED_SYNC_OPERATION",
      });
    }
    expect(status).toMatchObject({
      pendingOutboxCount: 0,
      deadOutboxCount: legacy.length,
    });

    // A dead event is never offered to the cloud again.
    const pushedAfterFirstRound = cloud.pushes.length;
    await runtime.runPushSync();
    expect(cloud.pushes).toHaveLength(pushedAfterFirstRound);
    const everyPushedId = cloud.pushes.flat().map((event) => event.eventId);
    for (const event of legacy) {
      expect(
        everyPushedId.filter((id) => id === event.eventId),
        event.eventId,
      ).toHaveLength(1);
    }

    // The refused rows stay local, untouched, for a person to discard.
    const untouched = database
      .prepare<
        [],
        { sync_state: string }
      >("SELECT sync_state FROM non_conformances WHERE id = 'nc:legacy'")
      .get();
    expect(untouched?.sync_state).toBe("local");

    database.close();
  });
});
