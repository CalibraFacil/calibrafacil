import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { SyncPushResponse } from "@calibra-facil/contracts";
import {
  applySyncPushResult,
  countBlockedOutbox,
  countDeferredOutbox,
  discardDeadOutboxEvent,
  getStoredAggregateVersion,
  listBlockedOutboxEvents,
  listPendingOutboxEvents,
  listSyncConflicts,
  markOutboxEventsFailedForRetry,
  openLocalDatabase,
  recomputeBlockedOutbox,
  requeueDeadOutboxEvent,
  resolveSyncConflict,
  runLocalMigrations,
  SyncConflictReasonRequiredError,
} from "./index";
import { stableLocalNumericId } from "./ids";
import { localDbMigrations } from "./migrations";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createDatabase() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-order-"));
  tempDirectories.push(directory);
  return openLocalDatabase({
    filePath: path.join(directory, "calibra.sqlite"),
  });
}

type Database = ReturnType<typeof createDatabase>;

let counter = 0;

/** Queues one event the way the writers do: a domain event plus its outbox row. */
function queue(
  database: Database,
  input: {
    kind: string;
    id: string;
    operation: string;
    payload?: Record<string, unknown>;
    /** The device clock: deliberately unrelated to the order they were written in. */
    createdAt?: string;
    actor?: string;
  },
) {
  counter += 1;
  const eventId = `event:${counter}`;
  const payload = JSON.stringify(input.payload ?? {});
  database
    .prepare(
      `
INSERT INTO domain_events (
  event_id, aggregate_kind, aggregate_id, aggregate_version, event_type,
  payload_json, metadata_json, actor_user_id, device_id, occurred_at, sync_state
) VALUES (@eventId, @kind, @id, 0, @operation, @payload, '{}', @actor, 'device-1',
  '2026-01-01T00:00:00.000Z', 'pending')
`,
    )
    .run({
      eventId,
      kind: input.kind,
      id: input.id,
      operation: input.operation,
      payload,
      actor: input.actor ?? "user-1",
    });
  database
    .prepare(
      `
INSERT INTO outbox (id, event_id, operation, payload_json, idempotency_key, status, created_at)
VALUES (@outboxId, @eventId, @operation, @payload, @key, 'pending', @createdAt)
`,
    )
    .run({
      outboxId: `outbox:${counter}`,
      eventId,
      operation: input.operation,
      payload,
      key: `local:${eventId}`,
      createdAt: input.createdAt ?? "2026-01-01T00:00:00.000Z",
    });
  return eventId;
}

function response(overrides: Partial<SyncPushResponse>): SyncPushResponse {
  return { accepted: [], rejected: [], conflicts: [], ...overrides };
}

function accept(eventId: string, aggregateVersion?: number) {
  return {
    eventId,
    remoteVersion: 1,
    cloudEventId: `cloud:${eventId}`,
    ...(aggregateVersion === undefined ? {} : { aggregateVersion }),
  };
}

function reject(database: Database, eventId: string, code: string) {
  applySyncPushResult(
    database,
    response({ rejected: [{ eventId, code, reason: `reason ${code}` }] }),
  );
}

function ids(events: Array<{ eventId: string }>) {
  return events.map((event) => event.eventId);
}

function outboxRow(database: Database, eventId: string) {
  return database
    .prepare<
      { eventId: string },
      {
        status: string;
        blocked_by_event_id: string | null;
        discarded_at: string | null;
        discarded_by: string | null;
        discard_reason: string | null;
        attempt_count: number;
        sync_state: string;
      }
    >(
      `
SELECT outbox.status, outbox.blocked_by_event_id, outbox.discarded_at, outbox.discarded_by,
  outbox.discard_reason, outbox.attempt_count, domain_events.sync_state
FROM outbox
INNER JOIN domain_events ON domain_events.event_id = outbox.event_id
WHERE outbox.event_id = @eventId
`,
    )
    .get({ eventId });
}

describe("REQ-E1-1: the outbox is pushed in per-aggregate order by the local sequence", () => {
  it("lists events in sequence order across aggregates, whatever the device clock said", () => {
    const database = createDatabase();
    // A clock that went backwards: created_at says the opposite of the order written in.
    const a1 = queue(database, {
      kind: "asset",
      id: "asset:a",
      operation: "create_local_asset",
      createdAt: "2026-03-01T10:00:00.000Z",
    });
    const b1 = queue(database, {
      kind: "customer",
      id: "customer:b",
      operation: "create_local_customer",
      createdAt: "2026-03-01T09:00:00.000Z",
    });
    const a2 = queue(database, {
      kind: "asset",
      id: "asset:a",
      operation: "update_local_asset",
      createdAt: "2026-03-01T08:00:00.000Z",
    });
    const b2 = queue(database, {
      kind: "customer",
      id: "customer:b",
      operation: "update_local_customer",
      createdAt: "2026-03-01T07:00:00.000Z",
    });

    const listed = listPendingOutboxEvents(database);

    expect(ids(listed)).toEqual([a1, b1, a2, b2]);
    expect(listed.map((event) => event.sequence)).toEqual(
      listed.map((event) => event.sequence).sort((x, y) => x - y),
    );

    database.close();
  });

  it("a record's later event is never listed while an earlier one of the same record backs off; other records go through", () => {
    const database = createDatabase();
    const first = queue(database, {
      kind: "calibration_job",
      id: "job:1",
      operation: "save_local_execution",
    });
    const second = queue(database, {
      kind: "calibration_job",
      id: "job:1",
      operation: "save_local_execution",
    });
    const other = queue(database, {
      kind: "calibration_job",
      id: "job:2",
      operation: "save_local_execution",
    });
    markOutboxEventsFailedForRetry(database, [first], "offline");

    // A scheduled run: the first is not due, so the second (a newer autosave of the SAME job)
    // must not overtake it; the other job is unaffected.
    expect(ids(listPendingOutboxEvents(database))).toEqual([other]);
    expect(countDeferredOutbox(database)).toBe(2);

    // A deliberate sync tries the delayed one too, and keeps the record's order.
    expect(
      ids(listPendingOutboxEvents(database, 50, { includeDeferred: true })),
    ).toEqual([other, first, second]);

    database.close();
  });

  it("another user's earlier event holds the record's later events too", () => {
    const database = createDatabase();
    const theirs = queue(database, {
      kind: "asset",
      id: "asset:shared",
      operation: "update_local_asset",
      actor: "user-2",
    });
    const mine = queue(database, {
      kind: "asset",
      id: "asset:shared",
      operation: "update_local_asset",
      actor: "user-1",
    });

    expect(
      ids(listPendingOutboxEvents(database, 50, { actorUserId: "user-1" })),
    ).toEqual([]);
    expect(
      ids(listPendingOutboxEvents(database, 50, { actorUserId: "user-2" })),
    ).toEqual([theirs, mine].slice(0, 1));

    database.close();
  });

  it("chains expected versions: 0 for a record created here, +1 per earlier event of the batch, then what the cloud confirmed", () => {
    const database = createDatabase();
    const create = queue(database, {
      kind: "asset",
      id: "asset:new",
      operation: "create_local_asset",
    });
    const edit = queue(database, {
      kind: "asset",
      id: "asset:new",
      operation: "update_local_asset",
    });
    const pulledEdit = queue(database, {
      kind: "asset",
      id: "asset:pulled",
      operation: "update_local_asset",
    });

    let listed = listPendingOutboxEvents(database);
    expect(
      listed.map((event) => [event.eventId, event.expectedVersion]),
    ).toEqual([
      [create, 0],
      [edit, 1],
      // A row this desktop only pulled has no version to expect: legacy comparison.
      [pulledEdit, null],
    ]);

    // The cloud confirms the first one only (the second was refused as a conflict).
    applySyncPushResult(database, response({ accepted: [accept(create, 1)] }));
    expect(getStoredAggregateVersion(database, "asset", "asset:new")).toBe(1);

    listed = listPendingOutboxEvents(database);
    expect(
      listed.map((event) => [event.eventId, event.expectedVersion]),
    ).toEqual([
      [edit, 1],
      [pulledEdit, null],
    ]);

    database.close();
  });

  it("an older cloud that sends no aggregate version records nothing, so nothing is expected of it", () => {
    const database = createDatabase();
    const edit = queue(database, {
      kind: "customer",
      id: "customer:1",
      operation: "update_local_customer",
    });
    applySyncPushResult(database, response({ accepted: [accept(edit)] }));

    expect(
      getStoredAggregateVersion(database, "customer", "customer:1"),
    ).toBeNull();
    const next = queue(database, {
      kind: "customer",
      id: "customer:1",
      operation: "update_local_customer",
    });
    expect(
      listPendingOutboxEvents(database).find((event) => event.eventId === next)
        ?.expectedVersion,
    ).toBeNull();

    database.close();
  });

  it("keeping the local change after a stale-version conflict adopts the version the cloud named", () => {
    const database = createDatabase();
    const edit = queue(database, {
      kind: "calibration_job",
      id: "job:9",
      operation: "save_local_execution",
    });
    applySyncPushResult(
      database,
      response({
        conflicts: [
          {
            id: "desktop-conflict:calibration_job:job-9:stale",
            eventId: edit,
            entityType: "calibration_job",
            entityId: "job:9",
            conflictType: "stale_version",
            status: "open",
            remotePayload: { aggregateVersion: 4, expectedVersion: 2 },
          },
        ],
      }),
    );
    expect(listPendingOutboxEvents(database)).toEqual([]);

    resolveSyncConflict(
      database,
      "desktop-conflict:calibration_job:job-9:stale",
      "resolved",
      { resolvedBy: "user-1" },
    );

    expect(
      getStoredAggregateVersion(database, "calibration_job", "job:9"),
    ).toBe(4);
    expect(
      listPendingOutboxEvents(database).map((event) => [
        event.eventId,
        event.expectedVersion,
      ]),
    ).toEqual([[edit, 4]]);

    database.close();
  });
});

describe("REQ-E1-2: a poison event is isolated and its dependents wait (blocked_by)", () => {
  it("a dead event blocks the later events of the same record, and only those", () => {
    const database = createDatabase();
    const poison = queue(database, {
      kind: "calibration_job",
      id: "job:1",
      operation: "save_local_execution",
    });
    const later = queue(database, {
      kind: "calibration_job",
      id: "job:1",
      operation: "save_local_execution",
    });
    const unrelated = queue(database, {
      kind: "calibration_job",
      id: "job:2",
      operation: "save_local_execution",
    });

    reject(database, poison, "INVALID_STANDARD_SNAPSHOT");

    expect(outboxRow(database, poison)?.status).toBe("dead");
    expect(outboxRow(database, later)).toMatchObject({
      status: "pending",
      blocked_by_event_id: poison,
      // Not an attempt of its own: it was never looked at.
      attempt_count: 0,
    });
    expect(outboxRow(database, unrelated)?.blocked_by_event_id).toBeNull();
    expect(ids(listPendingOutboxEvents(database))).toEqual([unrelated]);
    expect(countBlockedOutbox(database)).toBe(1);
    expect(listBlockedOutboxEvents(database)).toEqual([
      expect.objectContaining({
        eventId: later,
        blockedByEventId: poison,
        blockedByStatus: "dead",
        blockedByErrorCode: "INVALID_STANDARD_SNAPSHOT",
        regulated: true,
      }),
    ]);

    database.close();
  });

  it("an event the cloud did not look at (SYNC_PRECEDING_EVENT_NOT_APPLIED) is not a failed attempt", () => {
    const database = createDatabase();
    const poison = queue(database, {
      kind: "calibration_job",
      id: "job:1",
      operation: "save_local_execution",
    });
    const later = queue(database, {
      kind: "calibration_job",
      id: "job:1",
      operation: "save_local_execution",
    });

    applySyncPushResult(
      database,
      response({
        rejected: [
          { eventId: poison, code: "INVALID_STANDARD_SNAPSHOT", reason: "bad" },
          {
            eventId: later,
            code: "SYNC_PRECEDING_EVENT_NOT_APPLIED",
            reason: "earlier one was not applied",
          },
        ],
      }),
    );

    expect(outboxRow(database, later)).toMatchObject({
      status: "pending",
      attempt_count: 0,
      blocked_by_event_id: poison,
    });

    database.close();
  });

  it("an event in conflict blocks the later events of its record until the conflict is decided", () => {
    const database = createDatabase();
    const conflicted = queue(database, {
      kind: "asset",
      id: "asset:1",
      operation: "update_local_asset",
    });
    const later = queue(database, {
      kind: "asset",
      id: "asset:1",
      operation: "update_local_asset",
    });
    applySyncPushResult(
      database,
      response({
        conflicts: [
          {
            id: "desktop-conflict:asset:1",
            eventId: conflicted,
            entityType: "asset",
            entityId: "asset:1",
            conflictType: "concurrent_update",
            status: "open",
          },
        ],
      }),
    );

    expect(outboxRow(database, later)?.blocked_by_event_id).toBe(conflicted);
    expect(listPendingOutboxEvents(database)).toEqual([]);

    // Keep the local change: the conflicting event is pending again, ahead of its dependent.
    resolveSyncConflict(database, "desktop-conflict:asset:1", "resolved");

    expect(outboxRow(database, later)?.blocked_by_event_id).toBeNull();
    expect(ids(listPendingOutboxEvents(database))).toEqual([conflicted, later]);

    database.close();
  });

  it("the children of a record whose creation is dead wait for it: numeric references, local ids and attachment targets", () => {
    const database = createDatabase();
    const createCustomer = queue(database, {
      kind: "customer",
      id: "customer-local-1",
      operation: "create_local_customer",
    });
    const createAsset = queue(database, {
      kind: "asset",
      id: "asset-local-1",
      operation: "create_local_asset",
      payload: { customerId: stableLocalNumericId("customer-local-1") },
    });
    const intake = queue(database, {
      kind: "service_order",
      id: "so-local-1",
      operation: "create_local_service_order_intake",
      payload: {
        customerId: stableLocalNumericId("customer-local-1"),
        assetId: stableLocalNumericId("asset-local-1"),
      },
    });
    const notes = queue(database, {
      kind: "service_order_execution",
      id: "exec-1",
      operation: "save_local_service_order_execution_notes",
      payload: { serviceOrderId: "so-local-1" },
    });
    const photo = queue(database, {
      kind: "attachment",
      id: "att-1",
      operation: "create_local_attachment",
      payload: { entityType: "asset", entityId: "asset-local-1" },
    });
    const unrelated = queue(database, {
      kind: "customer",
      id: "customer-local-2",
      operation: "create_local_customer",
    });

    reject(database, createCustomer, "DOMAIN_VALIDATION_FAILED");

    // Grandchildren too: the asset (child of the customer) is blocked, and what refers to
    // the asset is blocked behind the same root cause.
    for (const dependent of [createAsset, intake, notes, photo]) {
      expect(
        outboxRow(database, dependent)?.blocked_by_event_id,
        dependent,
      ).toBe(createCustomer);
    }
    expect(outboxRow(database, unrelated)?.blocked_by_event_id).toBeNull();
    expect(ids(listPendingOutboxEvents(database))).toEqual([unrelated]);

    database.close();
  });

  it("a dead edit does not block the children of a record the cloud already has", () => {
    const database = createDatabase();
    // The customer was created and acknowledged earlier.
    const created = queue(database, {
      kind: "customer",
      id: "customer-local-1",
      operation: "create_local_customer",
    });
    applySyncPushResult(database, response({ accepted: [accept(created, 1)] }));
    const badEdit = queue(database, {
      kind: "customer",
      id: "customer-local-1",
      operation: "update_local_customer",
    });
    const intake = queue(database, {
      kind: "service_order",
      id: "so-local-1",
      operation: "create_local_service_order_intake",
      payload: { customerId: stableLocalNumericId("customer-local-1") },
    });

    reject(database, badEdit, "DOMAIN_VALIDATION_FAILED");

    expect(outboxRow(database, intake)?.blocked_by_event_id).toBeNull();
    expect(ids(listPendingOutboxEvents(database))).toEqual([intake]);

    database.close();
  });

  it("dependents wait, then flow once the parent is resolved: re-queued, they go after it, in order", () => {
    const database = createDatabase();
    const parent = queue(database, {
      kind: "asset",
      id: "asset-local-1",
      operation: "create_local_asset",
    });
    const sameRecord = queue(database, {
      kind: "asset",
      id: "asset-local-1",
      operation: "update_local_asset",
    });
    const child = queue(database, {
      kind: "attachment",
      id: "att-1",
      operation: "create_local_attachment",
      payload: { entityType: "asset", entityId: "asset-local-1" },
    });
    reject(database, parent, "TAG_ALREADY_EXISTS");
    expect(listPendingOutboxEvents(database)).toEqual([]);

    expect(requeueDeadOutboxEvent(database, parent)).toBe(true);

    expect(outboxRow(database, sameRecord)?.blocked_by_event_id).toBeNull();
    expect(outboxRow(database, child)?.blocked_by_event_id).toBeNull();
    expect(countBlockedOutbox(database)).toBe(0);
    expect(ids(listPendingOutboxEvents(database))).toEqual([
      parent,
      sameRecord,
      child,
    ]);

    database.close();
  });

  it("recompute is idempotent and releases what no longer has a blocker", () => {
    const database = createDatabase();
    const poison = queue(database, {
      kind: "asset",
      id: "asset:1",
      operation: "update_local_asset",
    });
    queue(database, {
      kind: "asset",
      id: "asset:1",
      operation: "update_local_asset",
    });
    reject(database, poison, "DOMAIN_VALIDATION_FAILED");

    expect(recomputeBlockedOutbox(database)).toBe(0);
    expect(countBlockedOutbox(database)).toBe(1);

    database.close();
  });
});

describe("REQ-E1-3: discarding is audited and final", () => {
  function conflictFor(
    database: Database,
    eventId: string,
    kind: string,
    id: string,
  ) {
    const conflictId = `desktop-conflict:${eventId}`;
    applySyncPushResult(
      database,
      response({
        conflicts: [
          {
            id: conflictId,
            eventId,
            entityType: kind,
            entityId: id,
            conflictType: "stale_version",
            status: "open",
            remotePayload: { aggregateVersion: 2 },
          },
        ],
      }),
    );
    return conflictId;
  }

  it("discarding a conflict records who, when and why on the conflict and on the event, and never resends it", () => {
    const database = createDatabase();
    const edit = queue(database, {
      kind: "asset",
      id: "asset:1",
      operation: "update_local_asset",
    });
    const conflictId = conflictFor(database, edit, "asset", "asset:1");

    const discarded = resolveSyncConflict(
      database,
      conflictId,
      "discarded_by_user",
      {
        resolvedBy: "user-1",
        reason: "A nuvem tem a versão certa",
      },
    );

    expect(discarded).toMatchObject({
      status: "discarded_by_user",
      resolvedBy: "user-1",
      resolutionReason: "A nuvem tem a versão certa",
      resolvedAt: expect.any(String),
    });
    expect(outboxRow(database, edit)).toMatchObject({
      // Not "synced": the cloud never received it. Kept, with the audit trail.
      status: "discarded",
      sync_state: "discarded",
      discarded_by: "user-1",
      discard_reason: "A nuvem tem a versão certa",
      discarded_at: expect.any(String),
    });
    expect(
      listPendingOutboxEvents(database, 50, { includeDeferred: true }),
    ).toEqual([]);
    // It is still in the local audit trace.
    expect(
      database
        .prepare<
          [],
          { total: number }
        >("SELECT COUNT(*) AS total FROM domain_events WHERE event_id = '" + edit + "'")
        .get()?.total,
    ).toBe(1);

    // Nothing brings it back: not a later push result, not a recompute, not a requeue.
    applySyncPushResult(database, response({}));
    recomputeBlockedOutbox(database);
    expect(requeueDeadOutboxEvent(database, edit)).toBe(false);
    expect(
      listPendingOutboxEvents(database, 50, { includeDeferred: true }),
    ).toEqual([]);
    expect(
      listSyncConflicts(database, { status: "discarded_by_user" }).total,
    ).toBe(1);

    database.close();
  });

  it("calibration readings cannot be discarded without a reason; other changes can", () => {
    const database = createDatabase();
    const submit = queue(database, {
      kind: "calibration_job",
      id: "job:1",
      operation: "submit_local_execution",
    });
    const edit = queue(database, {
      kind: "asset",
      id: "asset:1",
      operation: "update_local_asset",
    });
    const submitConflict = conflictFor(
      database,
      submit,
      "calibration_job",
      "job:1",
    );
    const editConflict = conflictFor(database, edit, "asset", "asset:1");

    expect(
      listSyncConflicts(database).data.map((c) => [c.id, c.regulated]),
    ).toEqual(
      expect.arrayContaining([
        [submitConflict, true],
        [editConflict, false],
      ]),
    );

    expect(() =>
      resolveSyncConflict(database, submitConflict, "discarded_by_user", {
        resolvedBy: "user-1",
        reason: "   ",
      }),
    ).toThrow(SyncConflictReasonRequiredError);
    // Refused whole: still open, still held.
    expect(outboxRow(database, submit)?.status).toBe("conflict");

    expect(
      resolveSyncConflict(database, submitConflict, "discarded_by_user", {
        resolvedBy: "user-1",
        reason: "Leituras feitas com o padrão errado",
      })?.status,
    ).toBe("discarded_by_user");
    expect(
      resolveSyncConflict(database, editConflict, "discarded_by_user", {
        resolvedBy: "user-1",
      })?.status,
    ).toBe("discarded_by_user");

    database.close();
  });

  it("the old name 'ignored' is a discard too (an older web build keeps working)", () => {
    const database = createDatabase();
    const submit = queue(database, {
      kind: "calibration_job",
      id: "job:1",
      operation: "submit_local_execution",
    });
    const conflictId = conflictFor(
      database,
      submit,
      "calibration_job",
      "job:1",
    );

    expect(resolveSyncConflict(database, conflictId, "ignored")?.status).toBe(
      "discarded_by_user",
    );
    expect(outboxRow(database, submit)?.status).toBe("discarded");

    database.close();
  });

  it("discarding a dead event records who and why", () => {
    const database = createDatabase();
    const dead = queue(database, {
      kind: "asset",
      id: "asset:1",
      operation: "update_local_asset",
    });
    reject(database, dead, "DOMAIN_VALIDATION_FAILED");

    discardDeadOutboxEvent(database, dead, {
      discardedBy: "user-7",
      reason: "Cadastro duplicado",
    });

    expect(outboxRow(database, dead)).toMatchObject({
      status: "discarded",
      discarded_by: "user-7",
      discard_reason: "Cadastro duplicado",
    });

    database.close();
  });

  it("discarding the creation of a record the cloud never got keeps its dependents blocked, to be decided one by one", () => {
    const database = createDatabase();
    const create = queue(database, {
      kind: "asset",
      id: "asset-local-1",
      operation: "create_local_asset",
    });
    const edit = queue(database, {
      kind: "asset",
      id: "asset-local-1",
      operation: "update_local_asset",
    });
    reject(database, create, "TAG_ALREADY_EXISTS");

    discardDeadOutboxEvent(database, create, { discardedBy: "user-1" });

    // The edit can never apply: it stays blocked by the discarded creation (not retried for
    // ever) and is listed so the user can decide about it.
    expect(outboxRow(database, edit)?.blocked_by_event_id).toBe(create);
    expect(listBlockedOutboxEvents(database)[0]).toMatchObject({
      eventId: edit,
      blockedByStatus: "discarded",
    });
    expect(listPendingOutboxEvents(database)).toEqual([]);

    expect(
      discardDeadOutboxEvent(database, edit, {
        discardedBy: "user-1",
        reason: "Cadastro descartado",
      })?.eventId,
    ).toBe(edit);
    expect(outboxRow(database, edit)).toMatchObject({
      status: "discarded",
      discarded_by: "user-1",
    });
    expect(countBlockedOutbox(database)).toBe(0);

    database.close();
  });

  it("a discarded edit (not a creation) releases the later events of its record", () => {
    const database = createDatabase();
    const first = queue(database, {
      kind: "asset",
      id: "asset:1",
      operation: "update_local_asset",
    });
    const second = queue(database, {
      kind: "asset",
      id: "asset:1",
      operation: "update_local_asset",
    });
    reject(database, first, "DOMAIN_VALIDATION_FAILED");
    expect(outboxRow(database, second)?.blocked_by_event_id).toBe(first);

    discardDeadOutboxEvent(database, first, { discardedBy: "user-1" });

    expect(outboxRow(database, second)?.blocked_by_event_id).toBeNull();
    expect(ids(listPendingOutboxEvents(database))).toEqual([second]);

    database.close();
  });
});

describe("compatibility: a database upgraded with a queue keeps every event", () => {
  it("migration 0025 is additive: pending, failed, dead and conflicting events survive and still behave", () => {
    const database = openLocalDatabase({
      filePath: path.join(
        mkdtempSync(path.join(os.tmpdir(), "calibra-upgrade-")),
        "calibra.sqlite",
      ),
      migrate: false,
    });
    database.exec(
      "CREATE TABLE IF NOT EXISTS local_schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);",
    );
    for (const migration of localDbMigrations.filter((item) => item.id < 25)) {
      database.exec(migration.sql);
      database
        .prepare(
          "INSERT INTO local_schema_migrations (id, name, applied_at) VALUES (?, ?, ?)",
        )
        .run(migration.id, migration.name, "2026-01-01T00:00:00.000Z");
    }

    const statuses = ["pending", "failed", "dead", "conflict", "synced"];
    for (const [index, status] of statuses.entries()) {
      database
        .prepare(
          `
INSERT INTO domain_events (event_id, aggregate_kind, aggregate_id, aggregate_version, event_type,
  payload_json, metadata_json, actor_user_id, device_id, occurred_at, sync_state)
VALUES (@eventId, 'asset', @aggregateId, 0, 'update_local_asset', '{}', '{}', 'user-1', 'device-1',
  '2026-01-01T00:00:00.000Z', @status)
`,
        )
        .run({
          eventId: `old:${status}`,
          aggregateId: `asset:${index}`,
          status,
        });
      database
        .prepare(
          `
INSERT INTO outbox (id, event_id, operation, payload_json, idempotency_key, status, created_at)
VALUES (@id, @eventId, 'update_local_asset', '{}', @key, @status, '2026-01-01T00:00:00.000Z')
`,
        )
        .run({
          id: `outbox:${status}`,
          eventId: `old:${status}`,
          key: `key:${status}`,
          status,
        });
    }

    runLocalMigrations(database);

    expect(
      database
        .prepare<[], { status: string }>(
          "SELECT status FROM outbox ORDER BY id",
        )
        .all()
        .map((row) => row.status),
    ).toEqual(["conflict", "dead", "failed", "pending", "synced"]);
    // The old queue is still sendable: nothing is blocked, and the due events are listed
    // with no expectation (the upgraded desktop knows no version yet).
    recomputeBlockedOutbox(database);
    expect(countBlockedOutbox(database)).toBe(0);
    expect(
      listPendingOutboxEvents(database, 50, { includeDeferred: true }).map(
        (event) => [event.eventId, event.expectedVersion],
      ),
    ).toEqual([
      ["old:pending", null],
      ["old:failed", null],
    ]);

    database.close();
  });
});
