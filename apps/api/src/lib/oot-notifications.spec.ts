/**
 * Tests for the §7.10 out-of-tolerance flag flow (#426 Phase 0).
 *
 * Mocks Drizzle `db`, the shared NC creator and the background-job enqueue to
 * assert the workflow contract of flagJobOutOfTolerance():
 *   - only approved-ish jobs can be flagged (404 / 409 codes otherwise);
 *   - one open OOT NC per job (self-healing when a previous flag died before
 *     the notification was created);
 *   - the notification row snapshots the recipient and the outbox row is only
 *     written when the customer has an e-mail address;
 *   - the PDF background job is enqueued;
 *   - flagging never touches the job row (OOT must not gate issuance).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockDbSelectFn,
  mockTransaction,
  mockTxInsertFn,
  mockTxValuesCalls,
  mockCreateNcRecord,
  mockEnqueue,
} = vi.hoisted(() => {
  function makeSelectChain(rows: unknown[]) {
    // Thenable chain so queries without .limit() (batch loads) also resolve.
    const chain = {
      from: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn().mockResolvedValue(rows),
      // oxlint-disable-next-line unicorn/no-thenable -- Drizzle's query builder is itself thenable; the mock must await like the real one.
      then: (
        resolve: (rows: unknown[]) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(rows).then(resolve, reject),
    };
    chain.from.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    chain.orderBy.mockReturnValue(chain);
    return chain;
  }

  const selectQueue: Array<unknown[]> = [];
  let selectIdx = 0;
  const selectFn = Object.assign(
    vi.fn(() => {
      const rows = selectQueue[selectIdx] ?? [];
      selectIdx++;
      return makeSelectChain(rows);
    }),
    {
      _queue: selectQueue,
      _reset: () => {
        selectQueue.length = 0;
        selectIdx = 0;
      },
    },
  );

  // Transaction insert mock: records .values(...) payloads per table token and
  // returns the inserted row via .returning() for the notification insert.
  const txValuesCalls: Array<{ table: unknown; values: unknown }> = [];
  const txInsertFn = vi.fn((table: unknown) => ({
    values: vi.fn((values: unknown) => {
      txValuesCalls.push({ table, values });
      const returning = vi
        .fn()
        .mockResolvedValue([
          { id: 900, ...(typeof values === "object" ? values : {}) },
        ]);
      const conflictChain = Object.assign(Promise.resolve([]), { returning });
      return {
        returning,
        onConflictDoNothing: vi.fn().mockReturnValue(conflictChain),
      };
    }),
  }));

  const transaction = vi.fn(
    async (cb: (tx: { insert: typeof txInsertFn }) => Promise<unknown>) =>
      cb({ insert: txInsertFn }),
  );

  return {
    mockDbSelectFn: selectFn,
    mockTransaction: transaction,
    mockTxInsertFn: txInsertFn,
    mockTxValuesCalls: txValuesCalls,
    mockCreateNcRecord: vi.fn(),
    mockEnqueue: vi.fn().mockResolvedValue({ messageId: "m1" }),
  };
});

vi.mock("@calibra-facil/db", () => ({
  db: {
    select: mockDbSelectFn,
    transaction: mockTransaction,
    // Direct inserts (standard_recall) share the recording tx-insert mock.
    insert: mockTxInsertFn,
  },
}));

vi.mock("@calibra-facil/db/schema", () => ({
  calibrationJob: {
    id: "j_id",
    jobId: "j_jobId",
    status: "j_status",
    customerId: "j_customerId",
    organizationId: "j_orgId",
    asFoundMargins: "j_margins",
  },
  customer: { id: "c_id", name: "c_name", email: "c_email" },
  nonConformance: {
    id: "nc_id",
    organizationId: "nc_orgId",
    jobId: "nc_jobId",
    type: "nc_type",
    status: "nc_status",
  },
  ootEmailOutbox: { _table: "oot_email_outbox" },
  ootNotification: {
    _table: "oot_notification",
    ncId: "n_ncId",
    jobId: "n_jobId",
    recallId: "n_recallId",
  },
  standardRecall: {
    _table: "standard_recall",
    id: "sr_id",
    organizationId: "sr_orgId",
    standardId: "sr_standardId",
    status: "sr_status",
    createdAt: "sr_createdAt",
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...original,
    eq: (_c: unknown, _v: unknown) => ({ _op: "eq" }),
    ne: (_c: unknown, _v: unknown) => ({ _op: "ne" }),
    and: (..._a: unknown[]) => ({ _op: "and" }),
    desc: (_c: unknown) => ({ _op: "desc" }),
    inArray: (_c: unknown, _v: unknown) => ({ _op: "inArray" }),
  };
});

vi.mock("./background-jobs", () => ({
  enqueueBackgroundJob: mockEnqueue,
}));

vi.mock("./non-conformances", () => ({
  createNonConformanceRecord: mockCreateNcRecord,
}));

import {
  createStandardRecallNotifications,
  ensureStandardRecall,
  flagJobOutOfTolerance,
} from "./oot-notifications";

function enqueueSelects(...rows: unknown[][]) {
  mockDbSelectFn._reset();
  for (const r of rows) mockDbSelectFn._queue.push(r);
}

const JOB_ROW = {
  id: 33,
  jobId: "CAL-2026-0100",
  status: "APPROVED",
  customerId: 12,
  asFoundMargins: [-0.4, 0.2, 0.9],
};

const CREATED_NC = {
  id: 501,
  ncNumber: "NC-2026-0010",
  type: "out_of_tolerance",
  description: "desc",
  status: "open",
  jobId: 33,
};

const BASE_PARAMS = {
  organizationId: "org-1",
  actorUserId: "user-1",
  jobId: 33,
  notifyCustomer: true,
  triggerSource: "as_found_verdict",
} satisfies Parameters<typeof flagJobOutOfTolerance>[0];

beforeEach(() => {
  vi.clearAllMocks();
  mockDbSelectFn._reset();
  mockTxValuesCalls.length = 0;
  mockCreateNcRecord.mockResolvedValue(CREATED_NC);
});

describe("flagJobOutOfTolerance", () => {
  it("returns JOB_NOT_FOUND when the job is not in the organization", async () => {
    enqueueSelects([]);
    const result = await flagJobOutOfTolerance(BASE_PARAMS);
    expect(result).toMatchObject({ ok: false, code: "JOB_NOT_FOUND" });
  });

  it("returns JOB_NOT_APPROVED for a job still in execution", async () => {
    enqueueSelects([{ ...JOB_ROW, status: "IN_PROGRESS" }]);
    const result = await flagJobOutOfTolerance(BASE_PARAMS);
    expect(result).toMatchObject({ ok: false, code: "JOB_NOT_APPROVED" });
  });

  it("returns OOT_ALREADY_FLAGGED when an open OOT NC with a notification exists", async () => {
    enqueueSelects(
      [JOB_ROW],
      [{ ...CREATED_NC, id: 400 }], // existing open OOT NC
      [{ id: 700 }], // its notification
    );
    const result = await flagJobOutOfTolerance(BASE_PARAMS);
    expect(result).toMatchObject({ ok: false, code: "OOT_ALREADY_FLAGGED" });
    expect(mockCreateNcRecord).not.toHaveBeenCalled();
  });

  it("self-heals: attaches the notification to an existing NC that lost it", async () => {
    enqueueSelects(
      [JOB_ROW],
      [{ ...CREATED_NC, id: 400 }], // existing open OOT NC
      [], // no notification yet
      [{ name: "Cliente X", email: "x@cliente.com" }], // customer snapshot
    );
    const result = await flagJobOutOfTolerance(BASE_PARAMS);
    expect(result.ok).toBe(true);
    expect(mockCreateNcRecord).not.toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ type: "OOT_NOTIFICATION" }),
    );
  });

  it("creates the typed NC, snapshots the recipient, writes the outbox row and enqueues the PDF", async () => {
    enqueueSelects(
      [JOB_ROW],
      [], // no existing OOT NC
      [{ name: "Cliente X", email: "x@cliente.com" }],
    );

    const result = await flagJobOutOfTolerance(BASE_PARAMS);

    expect(result.ok).toBe(true);
    expect(mockCreateNcRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "out_of_tolerance",
        triggerSource: "as_found_verdict",
        jobId: 33,
        organizationId: "org-1",
      }),
    );

    // Notification insert snapshots recipient + certificate context.
    const notificationInsert = mockTxValuesCalls.find(
      (call) =>
        typeof call.values === "object" &&
        call.values !== null &&
        "recipientEmail" in call.values,
    );
    expect(notificationInsert?.values).toMatchObject({
      recipientName: "Cliente X",
      recipientEmail: "x@cliente.com",
      certificateNumber: "CAL-2026-0100",
      status: "PENDING",
      approvedBy: "user-1",
    });

    // Outbox row written (customer has an address).
    const outboxInsert = mockTxValuesCalls.find(
      (call) =>
        typeof call.values === "object" &&
        call.values !== null &&
        "eventKey" in call.values,
    );
    expect(outboxInsert?.values).toMatchObject({
      eventKey: "oot_notification",
    });

    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ type: "OOT_NOTIFICATION", userId: "user-1" }),
    );
  });

  it("skips the outbox row (but still renders the PDF) when the customer has no e-mail", async () => {
    enqueueSelects([JOB_ROW], [], [{ name: "Cliente X", email: null }]);

    const result = await flagJobOutOfTolerance(BASE_PARAMS);

    expect(result.ok).toBe(true);
    const outboxInsert = mockTxValuesCalls.find(
      (call) =>
        typeof call.values === "object" &&
        call.values !== null &&
        "eventKey" in call.values,
    );
    expect(outboxInsert).toBeUndefined();
    expect(mockEnqueue).toHaveBeenCalled();
  });

  it("creates no notification when notifyCustomer is false", async () => {
    enqueueSelects([JOB_ROW], []);
    const result = await flagJobOutOfTolerance({
      ...BASE_PARAMS,
      notifyCustomer: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.notification).toBeNull();
    }
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("builds the default description from the as-found margins when none is given", async () => {
    enqueueSelects(
      [JOB_ROW],
      [],
      [{ name: "Cliente X", email: "x@cliente.com" }],
    );

    await flagJobOutOfTolerance(BASE_PARAMS);

    const call = mockCreateNcRecord.mock.calls[0]?.[0];
    expect(call.description).toContain("CAL-2026-0100");
    expect(call.description).toContain("1 de 3");
  });
});

describe("ensureStandardRecall", () => {
  const STANDARD = {
    id: 8,
    name: "Conjunto de Pesos E2",
    serialNumber: "SN-123",
    certificateNumber: "RBC-555",
    calibrationDate: new Date("2026-01-15T00:00:00Z"),
  };

  it("returns the existing DRAFT recall without creating a new NC", async () => {
    const draft = { id: 70, standardId: 8, ncId: 501, status: "DRAFT" };
    enqueueSelects([draft]);

    const result = await ensureStandardRecall({
      organizationId: "org-1",
      actorUserId: "user-1",
      standard: STANDARD,
    });

    expect(result).toEqual({ recall: draft, created: false });
    expect(mockCreateNcRecord).not.toHaveBeenCalled();
  });

  it("creates the NC (triggerSource standard_recall) and the DRAFT recall", async () => {
    enqueueSelects([]); // no existing draft

    const result = await ensureStandardRecall({
      organizationId: "org-1",
      actorUserId: "user-1",
      standard: STANDARD,
    });

    expect(result.created).toBe(true);
    expect(mockCreateNcRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "out_of_tolerance",
        triggerSource: "standard_recall",
        organizationId: "org-1",
      }),
    );
    const ncDescription = mockCreateNcRecord.mock.calls[0]?.[0]?.description;
    expect(ncDescription).toContain("Conjunto de Pesos E2");
    expect(ncDescription).toContain("15/01/2026");

    const recallInsert = mockTxValuesCalls.find(
      (call) =>
        typeof call.values === "object" &&
        call.values !== null &&
        "standardId" in call.values,
    );
    expect(recallInsert?.values).toMatchObject({
      standardId: 8,
      ncId: 501,
      status: "DRAFT",
      fromDate: STANDARD.calibrationDate,
      createdBy: "user-1",
    });
  });
});

describe("createStandardRecallNotifications", () => {
  const RECALL = {
    id: 70,
    organizationId: "org-1",
    standardId: 8,
    ncId: 501,
    status: "SENT",
  };

  function recallJob(id: number, jobId: string) {
    return {
      id,
      jobId,
      status: "APPROVED",
      customerId: 12,
      asFoundMargins: null,
    };
  }

  it("creates one notification per job and skips already-notified certificates", async () => {
    enqueueSelects(
      [CREATED_NC], // recall NC load
      [recallJob(1, "CAL-1"), recallJob(2, "CAL-2")], // org-scoped jobs
      [{ jobId: 2 }], // job 2 already notified in this recall
      [{ name: "Cliente X", email: "x@cliente.com" }], // recipient for job 1
    );

    const result = await createStandardRecallNotifications({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- test double narrowed to the fields the function reads
      recall: RECALL as never,
      jobIds: [1, 2],
      organizationId: "org-1",
      actorUserId: "user-9",
    });

    expect(result).toEqual({ created: 1, skipped: 1 });
    const notificationInsert = mockTxValuesCalls.find(
      (call) =>
        typeof call.values === "object" &&
        call.values !== null &&
        "recallId" in call.values,
    );
    expect(notificationInsert?.values).toMatchObject({
      recallId: 70,
      jobId: 1,
      certificateNumber: "CAL-1",
    });
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });

  it("counts jobs outside the organization as skipped", async () => {
    enqueueSelects(
      [CREATED_NC],
      [recallJob(1, "CAL-1")], // only job 1 is in-org
      [], // none notified yet
      [{ name: "Cliente X", email: "x@cliente.com" }],
    );

    const result = await createStandardRecallNotifications({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- test double narrowed to the fields the function reads
      recall: RECALL as never,
      jobIds: [1, 999],
      organizationId: "org-1",
      actorUserId: "user-9",
    });

    expect(result).toEqual({ created: 1, skipped: 1 });
  });
});
