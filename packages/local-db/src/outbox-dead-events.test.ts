import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  applySyncPushResult,
  countDeadOutbox,
  countPendingOutbox,
  createLocalCustomer,
  discardDeadOutboxEvent,
  listDeadOutboxEvents,
  listPendingOutboxEvents,
  markOutboxEventsFailedForRetry,
  openLocalDatabase,
  requeueDeadOutboxEvent,
  runLocalMigrations,
} from "./index";
import { localDbMigrations } from "./migrations";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function tempDatabasePath() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-dead-"));
  tempDirectories.push(directory);
  return path.join(directory, "calibra.sqlite");
}

function createDatabase() {
  return openLocalDatabase({ filePath: tempDatabasePath() });
}

type Database = ReturnType<typeof createDatabase>;

function queueCustomer(database: Database, name: string) {
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
    deviceId: "device-1",
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

function reject(database: Database, eventId: string, code: string) {
  applySyncPushResult(database, {
    accepted: [],
    rejected: [{ eventId, code, reason: `reason for ${code}` }],
    conflicts: [],
  });
}

function readOutbox(database: Database, eventId: string) {
  return database
    .prepare<
      { eventId: string },
      {
        status: string;
        attempt_count: number;
        last_error: string | null;
        error_code: string | null;
        next_attempt_at: string | null;
        dead_at: string | null;
        discarded_at: string | null;
        sync_state: string;
      }
    >(
      `
SELECT outbox.status, outbox.attempt_count, outbox.last_error, outbox.error_code,
  outbox.next_attempt_at, outbox.dead_at, outbox.discarded_at, domain_events.sync_state
FROM outbox
INNER JOIN domain_events ON domain_events.event_id = outbox.event_id
WHERE outbox.event_id = @eventId
`,
    )
    .get({ eventId });
}

describe("REQ-OB-1: a cloud rejection is dead or backs off, by its code", () => {
  it("REQ-OB-1: a permanent refusal becomes dead and keeps its code and message", () => {
    const database = createDatabase();
    const eventId = queueCustomer(database, "Cliente");

    reject(database, eventId, "STANDARD_EXPIRED");

    expect(readOutbox(database, eventId)).toMatchObject({
      status: "dead",
      attempt_count: 1,
      error_code: "STANDARD_EXPIRED",
      last_error: "STANDARD_EXPIRED: reason for STANDARD_EXPIRED",
      next_attempt_at: null,
      sync_state: "dead",
    });
    expect(readOutbox(database, eventId)?.dead_at).toEqual(expect.any(String));
    expect(countDeadOutbox(database)).toBe(1);
    expect(countPendingOutbox(database)).toBe(0);

    database.close();
  });

  it("REQ-OB-1: a transient refusal stays failed and backs off exponentially", () => {
    const database = createDatabase();
    const eventId = queueCustomer(database, "Cliente");

    const before = Date.now();
    reject(database, eventId, "SYNC_EVENT_IN_PROGRESS");
    const first = readOutbox(database, eventId);

    expect(first).toMatchObject({
      status: "failed",
      error_code: "SYNC_EVENT_IN_PROGRESS",
      sync_state: "failed",
      dead_at: null,
    });
    const firstDelay = Date.parse(first?.next_attempt_at ?? "") - before;
    expect(firstDelay).toBeGreaterThanOrEqual(25_000);

    reject(database, eventId, "SYNC_EVENT_IN_PROGRESS");
    const second = Date.parse(
      readOutbox(database, eventId)?.next_attempt_at ?? "",
    );
    expect(second - Date.now()).toBeGreaterThan(firstDelay + 20_000);
    expect(countDeadOutbox(database)).toBe(0);
    expect(countPendingOutbox(database)).toBe(1);

    database.close();
  });

  it("REQ-OB-1: an unknown code backs off rather than dying", () => {
    const database = createDatabase();
    const eventId = queueCustomer(database, "Cliente");

    reject(database, eventId, "FROM_A_NEWER_CLOUD");

    expect(readOutbox(database, eventId)).toMatchObject({
      status: "failed",
      error_code: "FROM_A_NEWER_CLOUD",
    });
    expect(readOutbox(database, eventId)?.next_attempt_at).toEqual(
      expect.any(String),
    );

    database.close();
  });
});

describe("REQ-OB-2: dead and backing-off events do not starve newer work", () => {
  it("REQ-OB-2: dead events are never selected, even when deferred events are included", () => {
    const database = createDatabase();
    const deadId = queueCustomer(database, "Morto");
    reject(database, deadId, "UNSUPPORTED_SYNC_OPERATION");

    expect(listPendingOutboxEvents(database)).toEqual([]);
    expect(
      listPendingOutboxEvents(database, 50, { includeDeferred: true }),
    ).toEqual([]);

    database.close();
  });

  it("REQ-OB-2: a newer event is listed with 60 dead events ahead of it", () => {
    const database = createDatabase();
    for (let index = 0; index < 60; index += 1) {
      const id = queueCustomer(database, `Morto ${index}`);
      reject(database, id, "UNSUPPORTED_SYNC_OPERATION");
    }
    const newest = queueCustomer(database, "Novo");

    expect(
      listPendingOutboxEvents(database, 50).map((event) => event.eventId),
    ).toEqual([newest]);

    database.close();
  });

  it("REQ-OB-2: a newer event is listed with 60 backing-off events ahead of it", () => {
    const database = createDatabase();
    const ids: string[] = [];
    for (let index = 0; index < 60; index += 1) {
      ids.push(queueCustomer(database, `Esperando ${index}`));
    }
    markOutboxEventsFailedForRetry(database, ids, "offline");
    const newest = queueCustomer(database, "Novo");

    expect(
      listPendingOutboxEvents(database, 50).map((event) => event.eventId),
    ).toEqual([newest]);

    database.close();
  });

  it("REQ-OB-2: a manual retry lists due events before backing-off ones", () => {
    const database = createDatabase();
    const ids: string[] = [];
    for (let index = 0; index < 60; index += 1) {
      ids.push(queueCustomer(database, `Esperando ${index}`));
    }
    markOutboxEventsFailedForRetry(database, ids, "offline");
    const newest = queueCustomer(database, "Novo");

    const listed = listPendingOutboxEvents(database, 50, {
      includeDeferred: true,
    });

    expect(listed).toHaveLength(50);
    expect(listed[0]?.eventId).toBe(newest);

    database.close();
  });
});

describe("REQ-OB-3: discarding and re-queueing dead events", () => {
  it("REQ-OB-3: lists dead events with code, message and whether they are regulated", () => {
    const database = createDatabase();
    const eventId = queueCustomer(database, "Cliente");
    reject(database, eventId, "STANDARD_EXPIRED");
    const live = queueCustomer(database, "Vivo");

    const dead = listDeadOutboxEvents(database);

    expect(dead).toHaveLength(1);
    expect(dead[0]).toMatchObject({
      eventId,
      entityType: "customer",
      operation: "create_local_customer",
      errorCode: "STANDARD_EXPIRED",
      errorMessage: "reason for STANDARD_EXPIRED",
      attemptCount: 1,
      regulated: false,
    });
    expect(dead.map((event) => event.eventId)).not.toContain(live);

    database.close();
  });

  it("REQ-OB-3: discarding removes the event from the queue and keeps a local audit trace", () => {
    const database = createDatabase();
    const eventId = queueCustomer(database, "Cliente");
    reject(database, eventId, "UNSUPPORTED_SYNC_OPERATION");

    const discarded = discardDeadOutboxEvent(database, eventId);

    expect(discarded?.eventId).toBe(eventId);
    expect(readOutbox(database, eventId)).toMatchObject({
      status: "discarded",
      sync_state: "discarded",
      error_code: "UNSUPPORTED_SYNC_OPERATION",
      last_error:
        "UNSUPPORTED_SYNC_OPERATION: reason for UNSUPPORTED_SYNC_OPERATION",
    });
    expect(readOutbox(database, eventId)?.discarded_at).toEqual(
      expect.any(String),
    );
    // The event itself is still on disk: only the queue entry is gone.
    expect(
      database
        .prepare<
          { eventId: string },
          { payload_json: string }
        >("SELECT payload_json FROM domain_events WHERE event_id = @eventId")
        .get({ eventId })?.payload_json,
    ).toContain("Cliente");
    expect(countDeadOutbox(database)).toBe(0);
    expect(listDeadOutboxEvents(database)).toEqual([]);
    expect(countPendingOutbox(database)).toBe(0);
    expect(
      listPendingOutboxEvents(database, 50, { includeDeferred: true }),
    ).toEqual([]);

    database.close();
  });

  it("REQ-OB-3: a discarded event stops marking its row as having unsent changes", () => {
    const database = createDatabase();
    const eventId = queueCustomer(database, "Cliente");
    reject(database, eventId, "UNSUPPORTED_SYNC_OPERATION");

    const unsettled = () =>
      database
        .prepare<
          [],
          { total: number }
        >("SELECT COUNT(*) AS total FROM outbox WHERE status NOT IN ('synced', 'discarded')")
        .get()?.total;
    expect(unsettled()).toBe(1);

    discardDeadOutboxEvent(database, eventId);

    expect(unsettled()).toBe(0);

    database.close();
  });

  it("REQ-OB-3: only a dead event can be discarded", () => {
    const database = createDatabase();
    const pending = queueCustomer(database, "Pendente");

    expect(discardDeadOutboxEvent(database, pending)).toBeNull();
    expect(discardDeadOutboxEvent(database, "event:missing")).toBeNull();
    expect(readOutbox(database, pending)?.status).toBe("pending");

    database.close();
  });

  it("REQ-OB-3: re-queueing puts a dead event back in the push queue", () => {
    const database = createDatabase();
    const eventId = queueCustomer(database, "Cliente");
    reject(database, eventId, "STANDARD_EXPIRED");

    expect(requeueDeadOutboxEvent(database, eventId)).toBe(true);

    expect(readOutbox(database, eventId)).toMatchObject({
      status: "pending",
      sync_state: "pending",
      next_attempt_at: null,
      dead_at: null,
      error_code: null,
      last_error: null,
    });
    expect(
      listPendingOutboxEvents(database).map((event) => event.eventId),
    ).toEqual([eventId]);
    expect(countDeadOutbox(database)).toBe(0);

    database.close();
  });

  it("REQ-OB-3: a re-queued event that is refused again goes back to dead", () => {
    const database = createDatabase();
    const eventId = queueCustomer(database, "Cliente");
    reject(database, eventId, "STANDARD_EXPIRED");
    requeueDeadOutboxEvent(database, eventId);

    reject(database, eventId, "STANDARD_EXPIRED");

    expect(readOutbox(database, eventId)?.status).toBe("dead");
    expect(readOutbox(database, eventId)?.attempt_count).toBe(2);

    database.close();
  });

  it("REQ-OB-3: only a dead event can be re-queued", () => {
    const database = createDatabase();
    const pending = queueCustomer(database, "Pendente");

    expect(requeueDeadOutboxEvent(database, pending)).toBe(false);
    expect(requeueDeadOutboxEvent(database, "event:missing")).toBe(false);

    database.close();
  });
});

describe("REQ-OB-4: events refused by an older build are classified by their stored code", () => {
  function databaseBeforeDeadState() {
    const database = openLocalDatabase({
      filePath: tempDatabasePath(),
      migrate: false,
    });
    database.exec(`
CREATE TABLE IF NOT EXISTS local_schema_migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`);
    for (const migration of localDbMigrations.filter((item) => item.id < 21)) {
      database.exec(migration.sql);
      database
        .prepare(
          "INSERT INTO local_schema_migrations (id, name, applied_at) VALUES (?, ?, ?)",
        )
        .run(migration.id, migration.name, "2026-01-01T00:00:00.000Z");
    }
    return database;
  }

  function insertLegacyEvent(
    database: Database,
    eventId: string,
    status: string,
    lastError: string | null,
    nextAttemptAt: string | null,
  ) {
    const now = "2026-01-01T00:00:00.000Z";
    database
      .prepare(
        `
INSERT INTO domain_events (
  event_id, aggregate_kind, aggregate_id, aggregate_version, event_type,
  payload_json, metadata_json, actor_user_id, device_id, occurred_at, sync_state
) VALUES (@eventId, 'customer', @eventId, 1, 'create_local_customer', '{}', '{}',
  'user-1', 'device-1', @now, @status)
`,
      )
      .run({ eventId, now, status });
    database
      .prepare(
        `
INSERT INTO outbox (
  id, event_id, operation, payload_json, idempotency_key, status, attempt_count,
  last_error, created_at, next_attempt_at
) VALUES (@id, @eventId, 'create_local_customer', '{}', @key, @status, 1,
  @lastError, @now, @nextAttemptAt)
`,
      )
      .run({
        id: `outbox:${eventId}`,
        eventId,
        key: `local:${eventId}`,
        status,
        lastError,
        nextAttemptAt,
        now,
      });
  }

  it("REQ-OB-4: dead-on-arrival rows become dead, transient and unrelated rows keep retrying", () => {
    const database = databaseBeforeDeadState();
    insertLegacyEvent(
      database,
      "event:expired",
      "failed",
      "STANDARD_EXPIRED: padrao vencido",
      null,
    );
    insertLegacyEvent(
      database,
      "event:unsupported",
      "failed",
      "UNSUPPORTED_SYNC_OPERATION: nope",
      null,
    );
    insertLegacyEvent(
      database,
      "event:in-progress",
      "failed",
      "SYNC_EVENT_IN_PROGRESS: busy",
      null,
    );
    insertLegacyEvent(
      database,
      "event:network",
      "failed",
      "Cloud push failed with HTTP 503",
      "2999-01-01T00:00:00.000Z",
    );
    insertLegacyEvent(
      database,
      "event:backing-off-permanent-code",
      "failed",
      "STANDARD_EXPIRED: padrao vencido",
      "2999-01-01T00:00:00.000Z",
    );
    insertLegacyEvent(database, "event:pending", "pending", null, null);
    insertLegacyEvent(
      database,
      "event:conflict",
      "conflict",
      "concurrent_update: conflict requires review",
      null,
    );

    runLocalMigrations(database);

    expect(readOutbox(database, "event:expired")).toMatchObject({
      status: "dead",
      sync_state: "dead",
      error_code: "STANDARD_EXPIRED",
      last_error: "STANDARD_EXPIRED: padrao vencido",
    });
    expect(readOutbox(database, "event:expired")?.dead_at).toEqual(
      expect.any(String),
    );
    expect(readOutbox(database, "event:unsupported")?.status).toBe("dead");
    expect(readOutbox(database, "event:in-progress")).toMatchObject({
      status: "failed",
      error_code: "SYNC_EVENT_IN_PROGRESS",
    });
    expect(readOutbox(database, "event:network")).toMatchObject({
      status: "failed",
      error_code: null,
    });
    // A row already backing off was not a dead-on-arrival one: left alone.
    expect(
      readOutbox(database, "event:backing-off-permanent-code"),
    ).toMatchObject({ status: "failed", error_code: null });
    expect(readOutbox(database, "event:pending")?.status).toBe("pending");
    expect(readOutbox(database, "event:conflict")?.status).toBe("conflict");
    expect(countDeadOutbox(database)).toBe(2);

    database.close();
  });
});
