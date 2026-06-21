/**
 * Tests for the transactional email outbox enqueue logic in recordServiceOrderEvent.
 *
 * Mini-spec E1 — PART 1 of service-order-emails (outbox enqueue).
 * REQ-SOEMAIL-041: repair_in_progress → outbox row
 * REQ-SOEMAIL-042: awaiting_calibration, calibration_in_progress → outbox rows
 * REQ-SOEMAIL-043: awaiting_tech_evaluation → outbox row
 * REQ-SOEMAIL-044: under_evaluation → outbox row
 *
 * Mini-spec F — Conclusão / entrega (outbox enqueue).
 * REQ-SOEMAIL-051: ready_for_pickup → outbox row
 * REQ-SOEMAIL-052: delivered → outbox row
 * REQ-SOEMAIL-053: closed → outbox row
 * REQ-SOEMAIL-054: awaiting_final_review → outbox row
 *
 * Mini-spec G — Cancelamento / garantia (outbox enqueue).
 * REQ-SOEMAIL-061: canceled → outbox row
 * REQ-SOEMAIL-062: warranty_return → outbox row
 */
import { describe, expect, it, vi } from "vitest";
import { serviceOrderEmailOutbox } from "@calibra-facil/db/schema";
import type { ServiceOrderEventInput } from "../service-order-workflow";
import { recordServiceOrderEvent } from "../service-order-workflow";

// ---------------------------------------------------------------------------
// Shared mock executor builder
// ---------------------------------------------------------------------------
// recordServiceOrderEvent has type: (event, executor) where executor is
// Pick<typeof db, "insert" | "select" | "update" | "delete">.
//
// The mock supports two call patterns:
//   1. await executor.insert(table).values(row)
//      - values() returns an object; `await` on a non-Promise object is a no-op
//        (resolves immediately to that object), which is fine since the return
//        value of the event-log insert is discarded.
//   2. await executor.insert(table).values(row).onConflictDoNothing(opts)
//      - onConflictDoNothing() records the outbox row and returns Promise.resolve().
//
// No `.then` property is added (no-thenable rule).

type CapturedInsert = {
  table: unknown;
  values: unknown;
  conflictTarget: unknown;
};

type MockInsertChain = {
  values: ReturnType<typeof vi.fn>;
};

type MockInsert = (table: unknown) => MockInsertChain;

// ServiceOrderDbExecutor is Pick<typeof db, "insert" | "select" | "update" | "delete">
// We implement insert fully and provide no-op stubs for the others.
function buildMockExecutor(): {
  insert: MockInsert;
  select: () => void;
  update: () => void;
  delete: () => void;
  capturedInserts: CapturedInsert[];
} {
  const capturedInserts: CapturedInsert[] = [];

  function insert(table: unknown): MockInsertChain {
    return {
      values: vi.fn((row: unknown) => ({
        onConflictDoNothing: vi.fn((opts: unknown) => {
          capturedInserts.push({ table, values: row, conflictTarget: opts });
          return Promise.resolve();
        }),
      })),
    };
  }

  return {
    insert,
    select: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    capturedInserts,
  };
}

// Helper: get outbox-specific inserts from captured inserts
function getOutboxInserts(executor: ReturnType<typeof buildMockExecutor>) {
  return executor.capturedInserts.filter(
    (c) => c.table === serviceOrderEmailOutbox,
  );
}

// ---------------------------------------------------------------------------
// Minimal valid event base shared across tests
// ---------------------------------------------------------------------------
const BASE_EVENT = {
  organizationId: "org-1",
  unitId: 10,
  serviceOrderId: 42,
  actorType: "lab_user",
  actorId: "user-1",
  eventType: "service_order.status_changed",
} satisfies Partial<ServiceOrderEventInput>;

// ---------------------------------------------------------------------------
// REQ-SOEMAIL-041 — repair_in_progress enqueues an outbox row
// REQ-SOEMAIL-042 — awaiting_calibration enqueues an outbox row
// REQ-SOEMAIL-042 — calibration_in_progress enqueues an outbox row
// REQ-SOEMAIL-043 — awaiting_tech_evaluation enqueues an outbox row
// REQ-SOEMAIL-044 — under_evaluation enqueues an outbox row
// REQ-SOEMAIL-051 — ready_for_pickup enqueues an outbox row
// REQ-SOEMAIL-052 — delivered enqueues an outbox row
// REQ-SOEMAIL-053 — closed enqueues an outbox row
// REQ-SOEMAIL-054 — awaiting_final_review enqueues an outbox row
// REQ-SOEMAIL-061 — canceled enqueues an outbox row
// REQ-SOEMAIL-062 — warranty_return enqueues an outbox row
// ---------------------------------------------------------------------------
describe(
  "REQ-SOEMAIL-041/042/043/044/051/052/053/054/061/062: qualifying status transitions enqueue outbox rows",
  () => {
  const TRIGGER_CASES: Array<{
    label: string;
    toStatus: string;
    expectedEventKey: string;
  }> = [
    {
      label: "REQ-SOEMAIL-041: repair_in_progress",
      toStatus: "repair_in_progress",
      expectedEventKey: "status_email:repair_in_progress",
    },
    {
      label: "REQ-SOEMAIL-042: awaiting_calibration",
      toStatus: "awaiting_calibration",
      expectedEventKey: "status_email:awaiting_calibration",
    },
    {
      label: "REQ-SOEMAIL-042: calibration_in_progress",
      toStatus: "calibration_in_progress",
      expectedEventKey: "status_email:calibration_in_progress",
    },
    {
      label: "REQ-SOEMAIL-043: awaiting_tech_evaluation",
      toStatus: "awaiting_tech_evaluation",
      expectedEventKey: "status_email:awaiting_tech_evaluation",
    },
    {
      label: "REQ-SOEMAIL-044: under_evaluation",
      toStatus: "under_evaluation",
      expectedEventKey: "status_email:under_evaluation",
    },
    {
      label: "REQ-SOEMAIL-051: ready_for_pickup",
      toStatus: "ready_for_pickup",
      expectedEventKey: "status_email:ready_for_pickup",
    },
    {
      label: "REQ-SOEMAIL-052: delivered",
      toStatus: "delivered",
      expectedEventKey: "status_email:delivered",
    },
    {
      label: "REQ-SOEMAIL-053: closed",
      toStatus: "closed",
      expectedEventKey: "status_email:closed",
    },
    {
      label: "REQ-SOEMAIL-054: awaiting_final_review",
      toStatus: "awaiting_final_review",
      expectedEventKey: "status_email:awaiting_final_review",
    },
    {
      label: "REQ-SOEMAIL-061: canceled",
      toStatus: "canceled",
      expectedEventKey: "status_email:canceled",
    },
    {
      label: "REQ-SOEMAIL-062: warranty_return",
      toStatus: "warranty_return",
      expectedEventKey: "status_email:warranty_return",
    },
  ];

  for (const tc of TRIGGER_CASES) {
    it(`${tc.label}: inserts ONE outbox row with correct fields`, async () => {
      const executor = buildMockExecutor();

      await recordServiceOrderEvent(
        {
          ...BASE_EVENT,
          oldValue: { status: "quote_approved" },
          newValue: { status: tc.toStatus },
        },
        // The mock satisfies the minimal executor shape used by this function.
        // We pass it via a helper to avoid a banned `as` assertion.
        toDbExecutor(executor),
      );

      const outboxInserts = getOutboxInserts(executor);
      expect(
        outboxInserts,
        `Expected 1 outbox insert for ${tc.toStatus}`,
      ).toHaveLength(1);

      const captured = outboxInserts[0];
      const row = captured.values;
      expect(row).toMatchObject({
        organizationId: "org-1",
        unitId: 10,
        serviceOrderId: 42,
        eventKey: tc.expectedEventKey,
        targetStatus: tc.toStatus,
      });

      // payload must carry at minimum the new status
      expect(getPayload(row)).toMatchObject({ status: tc.toStatus });

      // onConflictDoNothing must have been passed an argument (conflict target)
      expect(captured.conflictTarget).toBeDefined();
    });
  }
});

// ---------------------------------------------------------------------------
// Non-qualifying transitions must NOT produce outbox rows.
//
// Mutation check: if someone broadens the gate to enqueue every status,
// this test MUST go RED.
// ---------------------------------------------------------------------------
describe("Non-qualifying transitions: no outbox row", () => {
  const NON_TRIGGER_CASES: Array<{ label: string; toStatus: string }> = [
    { label: "quote_sent", toStatus: "quote_sent" },
    { label: "quote_approved", toStatus: "quote_approved" },
    { label: "opened", toStatus: "opened" },
    { label: "awaiting_quote_approval", toStatus: "awaiting_quote_approval" },
  ];

  for (const tc of NON_TRIGGER_CASES) {
    it(`status ${tc.toStatus} does NOT insert an outbox row`, async () => {
      const executor = buildMockExecutor();

      await recordServiceOrderEvent(
        {
          ...BASE_EVENT,
          oldValue: { status: "opened" },
          newValue: { status: tc.toStatus },
        },
        toDbExecutor(executor),
      );

      const outboxInserts = getOutboxInserts(executor);
      expect(
        outboxInserts,
        `Expected 0 outbox inserts for non-trigger status ${tc.toStatus}`,
      ).toHaveLength(0);
    });
  }
});

// ---------------------------------------------------------------------------
// No status change → no outbox row
// ---------------------------------------------------------------------------
describe("No status in newValue → no outbox row", () => {
  it("event without newValue.status does not enqueue", async () => {
    const executor = buildMockExecutor();

    await recordServiceOrderEvent(
      {
        ...BASE_EVENT,
        newValue: { technicianId: "user-2" },
      },
      toDbExecutor(executor),
    );

    expect(getOutboxInserts(executor)).toHaveLength(0);
  });

  it("event with no newValue at all does not enqueue", async () => {
    const executor = buildMockExecutor();

    await recordServiceOrderEvent(
      { ...BASE_EVENT },
      toDbExecutor(executor),
    );

    expect(getOutboxInserts(executor)).toHaveLength(0);
  });

  it("event where newValue.status equals oldValue.status does not enqueue", async () => {
    const executor = buildMockExecutor();

    await recordServiceOrderEvent(
      {
        ...BASE_EVENT,
        oldValue: { status: "repair_in_progress" },
        newValue: { status: "repair_in_progress" },
      },
      toDbExecutor(executor),
    );

    expect(getOutboxInserts(executor)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Same-executor guarantee: the outbox insert MUST use the passed executor,
// NOT the default `db` singleton. If the code switches to `db`, the insert
// won't appear on our mock executor → test goes RED.
// ---------------------------------------------------------------------------
describe("Same-executor guarantee (transaction safety)", () => {
  it("outbox insert goes through the executor argument, not the module-level db", async () => {
    const executor = buildMockExecutor();

    await recordServiceOrderEvent(
      {
        ...BASE_EVENT,
        oldValue: { status: "quote_approved" },
        newValue: { status: "repair_in_progress" },
      },
      toDbExecutor(executor),
    );

    // If the code used the module-level `db` instead of the passed executor,
    // capturedInserts would be empty → this assertion goes RED.
    const outboxInserts = getOutboxInserts(executor);
    expect(outboxInserts).toHaveLength(1);
    expect(outboxInserts[0].table).toBe(serviceOrderEmailOutbox);
  });
});

// ---------------------------------------------------------------------------
// Dedup: onConflictDoNothing must be present on the outbox insert.
// Without it, re-running the same transition would INSERT a duplicate row
// (violating the UNIQUE constraint on service_order_id + event_key).
// ---------------------------------------------------------------------------
describe("Dedup: onConflictDoNothing present on outbox insert", () => {
  it("outbox insert calls onConflictDoNothing with a defined target", async () => {
    const executor = buildMockExecutor();

    await recordServiceOrderEvent(
      {
        ...BASE_EVENT,
        oldValue: { status: "opened" },
        newValue: { status: "repair_in_progress" },
      },
      toDbExecutor(executor),
    );

    const outboxInserts = getOutboxInserts(executor);
    expect(outboxInserts).toHaveLength(1);
    // Must be called with a conflict target (not nothing/undefined).
    expect(outboxInserts[0].conflictTarget).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Adapts the mock executor to the `ServiceOrderDbExecutor` type without using
 * a banned `as` type assertion.  The function signature forces TypeScript to
 * accept the compatible subset — insert/select/update/delete stubs — without
 * needing a runtime cast.
 */
function toDbExecutor(
  mock: ReturnType<typeof buildMockExecutor>,
): Parameters<typeof recordServiceOrderEvent>[1] {
  // The mock's `insert` method returns the right shape.  TypeScript accepts this
  // because the mock's return type is structurally compatible with what
  // recordServiceOrderEvent expects from its second parameter.
  return mock satisfies Pick<
    ReturnType<typeof buildMockExecutor>,
    "insert" | "select" | "update" | "delete"
  >;
}

/**
 * Extracts and validates the payload field from a captured insert row.
 * Avoids a banned `as Record<string, unknown>` assertion by using a type guard.
 */
function getPayload(row: unknown): Record<string, unknown> {
  if (
    row !== null &&
    typeof row === "object" &&
    "payload" in row &&
    row.payload !== null &&
    typeof row.payload === "object"
  ) {
    return row.payload satisfies Record<string, unknown>;
  }
  return {};
}
