/**
 * Tests for mini-spec H — Idempotency / dedup (REQ-SOEMAIL-007, 008, 009).
 *
 * Unit-tests the send-once helper `sendServiceOrderEmailOnce` in isolation by
 * mocking @calibra-facil/db so no real DB is needed.
 *
 * Coverage:
 *  - REQ-SOEMAIL-007: key is recorded (INSERT … ON CONFLICT DO NOTHING) before dispatch.
 *  - REQ-SOEMAIL-008: if key already exists (conflict → no row returned) dispatch is NOT called.
 *  - REQ-SOEMAIL-009: if dispatch reports not-sent after claim, the log row is DELETED so
 *    a retry can resend.
 *  - (a) claim returns a row → dispatch is called once.
 *  - (b) claim returns empty (conflict) → dispatch NOT called.
 *  - (c) claimed + dispatch reports not-sent → DELETE is issued.
 *  - (d) claimed + dispatch sent → no DELETE.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock @calibra-facil/db — mirroring the pattern used by B and C dispatch tests.
// All mock functions must be hoisted so they are available inside vi.mock factories.
// ---------------------------------------------------------------------------

const { mockInsert, mockDelete, mockUpdate } = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockDelete: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock("@calibra-facil/db", () => ({
  db: {
    insert: mockInsert,
    delete: mockDelete,
    update: mockUpdate,
  },
}));

vi.mock("@calibra-facil/db/schema", () => ({
  serviceOrderEmailLog: {
    serviceOrderId: "serviceOrderId",
    eventKey: "eventKey",
    id: "id",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import { sendServiceOrderEmailOnce } from "./service-order-email-once";

// ---------------------------------------------------------------------------
// Drizzle builder stub helpers
//
// Drizzle uses a builder pattern: db.insert(table).values(...).onConflictDoNothing().returning()
// We set up chainable mocks that ultimately resolve.
// ---------------------------------------------------------------------------

/** Build a chainable INSERT builder that resolves to `rows`. */
function makeInsertChain(rows: unknown[]) {
  const chain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(rows),
  };
  mockInsert.mockReturnValue(chain);
  return chain;
}

/** Build a chainable DELETE builder that resolves. */
function makeDeleteChain() {
  const chain = {
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  };
  mockDelete.mockReturnValue(chain);
  return chain;
}

/** Build a chainable UPDATE builder that resolves. */
function makeUpdateChain() {
  const chain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  };
  mockUpdate.mockReturnValue(chain);
  return chain;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("REQ-SOEMAIL-007: record each sent email keyed by (serviceOrderId, eventKey)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("REQ-SOEMAIL-007: INSERT is called with serviceOrderId and eventKey before dispatch", async () => {
    // claim → returns a row (claimed)
    const insertChain = makeInsertChain([{ id: 1 }]);
    makeDeleteChain();

    const dispatch = vi.fn().mockResolvedValue({ sent: true });

    await sendServiceOrderEmailOnce({
      serviceOrderId: 42,
      eventKey: "nova_os",
      dispatch,
    });

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceOrderId: 42,
        eventKey: "nova_os",
      }),
    );
    expect(insertChain.onConflictDoNothing).toHaveBeenCalledTimes(1);
    expect(insertChain.returning).toHaveBeenCalledTimes(1);
  });
});

describe("REQ-SOEMAIL-008: already recorded → skip dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("REQ-SOEMAIL-008: dispatch is NOT called when INSERT returns empty (conflict)", async () => {
    // conflict → no row returned
    makeInsertChain([]);

    const dispatch = vi.fn();

    await sendServiceOrderEmailOnce({
      serviceOrderId: 7,
      eventKey: "orcamento_sent:99",
      dispatch,
    });

    expect(dispatch).not.toHaveBeenCalled();
  });

  it("REQ-SOEMAIL-008: dispatch is NOT called a second time when key is already recorded", async () => {
    // Simulate a second run of the same event
    makeInsertChain([]); // conflict on second run

    const dispatch = vi.fn();
    await sendServiceOrderEmailOnce({
      serviceOrderId: 7,
      eventKey: "orcamento_sent:99",
      dispatch,
    });

    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("REQ-SOEMAIL-009: dispatch fails after claim → release key (DELETE)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("REQ-SOEMAIL-009: DELETE is called when dispatch reports not-sent (sent: false)", async () => {
    // claim succeeds → row id 1
    makeInsertChain([{ id: 1 }]);
    const deleteChain = makeDeleteChain();

    // dispatch reports failure
    const dispatch = vi
      .fn()
      .mockResolvedValue({ sent: false, error: "Transport failure" });

    await sendServiceOrderEmailOnce({
      serviceOrderId: 10,
      eventKey: "nova_os",
      dispatch,
    });

    // dispatch was called
    expect(dispatch).toHaveBeenCalledTimes(1);
    // DELETE was issued to release the key
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(deleteChain.where).toHaveBeenCalledTimes(1);
  });

  it("REQ-SOEMAIL-009: DELETE is called when dispatch reports skipped (sent: false, skipped: true)", async () => {
    makeInsertChain([{ id: 2 }]);
    const deleteChain = makeDeleteChain();

    const dispatch = vi.fn().mockResolvedValue({
      sent: false,
      skipped: true,
      skipReason: "No valid recipient address could be resolved",
    });

    await sendServiceOrderEmailOnce({
      serviceOrderId: 11,
      eventKey: "nova_os",
      dispatch,
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(deleteChain.where).toHaveBeenCalledTimes(1);
  });

  it("REQ-SOEMAIL-009: DELETE is called when dispatch throws (treat as not-sent)", async () => {
    makeInsertChain([{ id: 3 }]);
    const deleteChain = makeDeleteChain();

    const dispatch = vi.fn().mockRejectedValue(new Error("Network error"));

    await sendServiceOrderEmailOnce({
      serviceOrderId: 12,
      eventKey: "nova_os",
      dispatch,
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    // DELETE must be issued even when dispatch throws
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(deleteChain.where).toHaveBeenCalledTimes(1);
  });
});

describe("(d) claimed + dispatch sent → no release DELETE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("REQ-SOEMAIL-007+008: no DELETE when dispatch reports sent: true", async () => {
    makeInsertChain([{ id: 5 }]);

    const dispatch = vi
      .fn()
      .mockResolvedValue({ sent: true, emailId: "email-abc" });

    await sendServiceOrderEmailOnce({
      serviceOrderId: 20,
      eventKey: "nova_os",
      dispatch,
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    // No DELETE — key is kept
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe("recipient stamp (#343 communications log)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("UPDATEs the kept log row with recipientEmail when dispatch reports it", async () => {
    makeInsertChain([{ id: 8 }]);
    const updateChain = makeUpdateChain();

    const outcome = await sendServiceOrderEmailOnce({
      serviceOrderId: 21,
      eventKey: "nova_os",
      dispatch: async () => ({
        sent: true,
        emailId: "email-xyz",
        recipientEmail: "cliente@exemplo.com.br",
      }),
    });

    expect(outcome).toBe("sent");
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(updateChain.set).toHaveBeenCalledWith({
      recipientEmail: "cliente@exemplo.com.br",
    });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("skips the UPDATE when the sent result has no recipientEmail", async () => {
    makeInsertChain([{ id: 9 }]);
    makeUpdateChain();

    await sendServiceOrderEmailOnce({
      serviceOrderId: 22,
      eventKey: "nova_os",
      dispatch: async () => ({ sent: true }),
    });

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("still returns 'sent' when the recipient stamp UPDATE throws (best-effort)", async () => {
    makeInsertChain([{ id: 10 }]);
    mockUpdate.mockImplementation(() => {
      throw new Error("db down");
    });

    const outcome = await sendServiceOrderEmailOnce({
      serviceOrderId: 23,
      eventKey: "nova_os",
      dispatch: async () => ({
        sent: true,
        recipientEmail: "cliente@exemplo.com.br",
      }),
    });

    expect(outcome).toBe("sent");
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe("helper never throws (best-effort)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not throw when INSERT itself throws", async () => {
    mockInsert.mockImplementation(() => {
      throw new Error("DB insert error");
    });

    const dispatch = vi.fn();

    await expect(
      sendServiceOrderEmailOnce({
        serviceOrderId: 1,
        eventKey: "nova_os",
        dispatch,
      }),
    ).resolves.not.toThrow();

    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not throw when DELETE itself throws", async () => {
    makeInsertChain([{ id: 99 }]);

    // DELETE chain that throws
    const throwingChain = {
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockRejectedValue(new Error("DB delete error")),
    };
    mockDelete.mockReturnValue(throwingChain);

    const dispatch = vi.fn().mockResolvedValue({ sent: false, error: "fail" });

    await expect(
      sendServiceOrderEmailOnce({
        serviceOrderId: 2,
        eventKey: "nova_os",
        dispatch,
      }),
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Outcome contract — the outbox drain relies on this return value to decide
// whether to mark a row done ("sent"/"deduped") or release it for retry
// ("failed"). This is what makes the lease-based strand recovery safe for the
// no-other-dedup status_email path.
// ---------------------------------------------------------------------------

describe("outcome contract (sent | deduped | failed)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 'sent' when the key is claimed and dispatch reports sent: true", async () => {
    makeInsertChain([{ id: 1 }]);

    const outcome = await sendServiceOrderEmailOnce({
      serviceOrderId: 1,
      eventKey: "status_email:repair_in_progress",
      dispatch: async () => ({ sent: true, emailId: "e-1" }),
    });

    expect(outcome).toBe("sent");
  });

  it("returns 'deduped' (no dispatch) when the key is already recorded — the reclaim-after-send case", async () => {
    makeInsertChain([]); // ON CONFLICT DO NOTHING returned no row
    const dispatch = vi.fn();

    const outcome = await sendServiceOrderEmailOnce({
      serviceOrderId: 1,
      eventKey: "status_email:repair_in_progress",
      dispatch,
    });

    expect(outcome).toBe("deduped");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("returns 'failed' when dispatch reports not-sent (key released for retry)", async () => {
    makeInsertChain([{ id: 1 }]);
    makeDeleteChain();

    const outcome = await sendServiceOrderEmailOnce({
      serviceOrderId: 1,
      eventKey: "status_email:repair_in_progress",
      dispatch: async () => ({ sent: false, error: "SMTP down" }),
    });

    expect(outcome).toBe("failed");
  });

  it("returns 'failed' when dispatch throws", async () => {
    makeInsertChain([{ id: 1 }]);
    makeDeleteChain();

    const outcome = await sendServiceOrderEmailOnce({
      serviceOrderId: 1,
      eventKey: "status_email:repair_in_progress",
      dispatch: async () => {
        throw new Error("transport exploded");
      },
    });

    expect(outcome).toBe("failed");
  });

  it("returns 'failed' when the claim INSERT itself throws (no dispatch)", async () => {
    mockInsert.mockImplementation(() => {
      throw new Error("db down");
    });
    const dispatch = vi.fn();

    const outcome = await sendServiceOrderEmailOnce({
      serviceOrderId: 1,
      eventKey: "status_email:repair_in_progress",
      dispatch,
    });

    expect(outcome).toBe("failed");
    expect(dispatch).not.toHaveBeenCalled();
  });
});
