import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { openLocalDatabase } from "./database";
import {
  recomputeServiceOrderSyncStates,
  resolveServiceOrdersForAggregates,
} from "./service-orders";

/**
 * Saving a quote or delivery-document draft marks the *parent* order `local`,
 * but accepting that child event only marks the child synced. Without
 * recomputation the order reports pending local changes forever — which blocks
 * sending the very quote that was just created, and every cloud delivery and
 * document action on the order.
 */
const tempDirectories: string[] = [];

function createDatabase() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-so-sync-"));
  tempDirectories.push(directory);

  return openLocalDatabase({
    filePath: path.join(directory, "calibra.sqlite"),
  });
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

type Db = ReturnType<typeof createDatabase>;

function seedOrder(
  database: Db,
  { remoteId = 42 }: { remoteId?: number | null } = {},
) {
  database
    .prepare(
      `INSERT INTO service_orders (
         id, remote_id, organization_id, unit_id, customer_id, asset_id,
         service_order_number, status, priority, intake_type,
         claimed_defect, intake_condition, delivery_method,
         opened_at, updated_at, sync_state
       ) VALUES (
         'so-1', @remoteId, 'org-1', 1, 'c-1', 'a-1',
         'OS-1', 'opened', 'normal', 'counter',
         'Nao liga', 'Sem danos', 'pickup_at_lab',
         '2026-01-01', '2026-01-01', 'local'
       )`,
    )
    .run({ remoteId });
}

function seedQuote(database: Db, id = "quote-1") {
  database
    .prepare(
      `INSERT INTO service_order_quotes (
         id, service_order_id, quote_number, version, status,
         created_at, updated_at, sync_state
       ) VALUES (
         @id, 'so-1', @id, 1, 'draft', '2026-01-01', '2026-01-01', 'local'
       )`,
    )
    .run({ id });
}

function seedOutboxEvent(
  database: Db,
  {
    eventId,
    aggregateKind,
    aggregateId,
    status,
  }: {
    eventId: string;
    aggregateKind: string;
    aggregateId: string;
    status: "pending" | "synced" | "failed" | "conflict";
  },
) {
  database
    .prepare(
      `INSERT INTO domain_events (
         event_id, aggregate_kind, aggregate_id, aggregate_version,
         event_type, payload_json, metadata_json, device_id, occurred_at, sync_state
       ) VALUES (
         @eventId, @aggregateKind, @aggregateId, 1,
         'created', '{}', '{}', 'device-1', '2026-01-01', 'local'
       )`,
    )
    .run({ eventId, aggregateKind, aggregateId });

  database
    .prepare(
      `INSERT INTO outbox (
         id, event_id, operation, payload_json, idempotency_key, status, created_at
       ) VALUES (@eventId, @eventId, 'op', '{}', @eventId, @status, '2026-01-01')`,
    )
    .run({ eventId, status });
}

function syncStateOf(database: Db) {
  return database
    .prepare<
      [],
      { sync_state: string }
    >("SELECT sync_state FROM service_orders WHERE id = 'so-1'")
    .get()?.sync_state;
}

describe("resolveServiceOrdersForAggregates", () => {
  it("returns the order itself", () => {
    const database = createDatabase();
    seedOrder(database);

    expect(
      resolveServiceOrdersForAggregates(database, [
        { kind: "service_order", id: "so-1" },
      ]),
    ).toEqual(["so-1"]);
  });

  it("walks back from a child row to its parent", () => {
    const database = createDatabase();
    seedOrder(database);
    seedQuote(database);

    expect(
      resolveServiceOrdersForAggregates(database, [
        { kind: "service_order_quote", id: "quote-1" },
      ]),
    ).toEqual(["so-1"]);
  });

  it("resolves a whole batch without a query per event", () => {
    // This runs on every push cycle while a backlog drains, so batching is
    // the point — one query per child table, not one per event.
    const database = createDatabase();
    seedOrder(database);
    seedQuote(database, "quote-1");
    seedQuote(database, "quote-2");

    expect(
      resolveServiceOrdersForAggregates(database, [
        { kind: "service_order_quote", id: "quote-1" },
        { kind: "service_order_quote", id: "quote-2" },
        { kind: "service_order", id: "so-1" },
      ]),
    ).toEqual(["so-1"]);
  });

  it("ignores an unrelated aggregate", () => {
    const database = createDatabase();

    expect(
      resolveServiceOrdersForAggregates(database, [
        { kind: "calibration_job", id: "job-1" },
      ]),
    ).toEqual([]);
  });
});

describe("recomputeServiceOrderSyncStates", () => {
  it("clears the parent once its child event is accepted", () => {
    // The exact defect: the quote is synced, the order is not, and nothing
    // ever puts it right.
    const database = createDatabase();
    seedOrder(database);
    seedQuote(database);
    seedOutboxEvent(database, {
      eventId: "e-1",
      aggregateKind: "service_order_quote",
      aggregateId: "quote-1",
      status: "synced",
    });

    recomputeServiceOrderSyncStates(database, ["so-1"]);

    expect(syncStateOf(database)).toBe("synced");
  });

  it("keeps the parent dirty while another child is still queued", () => {
    const database = createDatabase();
    seedOrder(database);
    seedQuote(database, "quote-1");
    seedQuote(database, "quote-2");
    seedOutboxEvent(database, {
      eventId: "e-1",
      aggregateKind: "service_order_quote",
      aggregateId: "quote-1",
      status: "synced",
    });
    seedOutboxEvent(database, {
      eventId: "e-2",
      aggregateKind: "service_order_quote",
      aggregateId: "quote-2",
      status: "pending",
    });

    recomputeServiceOrderSyncStates(database, ["so-1"]);

    expect(syncStateOf(database)).toBe("local");
  });

  it("keeps the parent dirty when an event was rejected", () => {
    // A rejection means local state genuinely differs from the server's.
    const database = createDatabase();
    seedOrder(database);
    seedQuote(database);
    seedOutboxEvent(database, {
      eventId: "e-1",
      aggregateKind: "service_order_quote",
      aggregateId: "quote-1",
      status: "failed",
    });

    recomputeServiceOrderSyncStates(database, ["so-1"]);

    expect(syncStateOf(database)).toBe("local");
  });

  it("keeps the parent dirty while its own edit is queued", () => {
    const database = createDatabase();
    seedOrder(database);
    seedOutboxEvent(database, {
      eventId: "e-1",
      aggregateKind: "service_order",
      aggregateId: "so-1",
      status: "pending",
    });

    recomputeServiceOrderSyncStates(database, ["so-1"]);

    expect(syncStateOf(database)).toBe("local");
  });

  it("never marks an order that has no cloud identity as synced", () => {
    // An order created offline has nothing on the server to be in sync with.
    const database = createDatabase();
    seedOrder(database, { remoteId: null });

    recomputeServiceOrderSyncStates(database, ["so-1"]);

    expect(syncStateOf(database)).toBe("local");
  });
});
