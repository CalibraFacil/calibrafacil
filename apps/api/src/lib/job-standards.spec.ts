/**
 * Tests for the reverse-traceability helpers (#426 Phase 1).
 *
 * Mocks Drizzle `db` to assert:
 *   - syncJobStandardLinks: full rewrite semantics (undefined = keep,
 *     null/[] = clear, ids deduped), and that failures never propagate;
 *   - findImpactedCertificates: amendment-chain collapse (superseded original
 *     dropped when its replacement is in the set, kept + annotated when not)
 *     and the already-notified flag.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDbSelectFn, mockTransaction, mockTxDelete, mockTxInsertValues } =
  vi.hoisted(() => {
    function makeSelectChain(rows: unknown[]) {
      // Thenable chain: every builder method returns `this`, awaiting the
      // chain resolves the queued rows regardless of terminal method.
      const chain = {
        from: vi.fn(),
        innerJoin: vi.fn(),
        where: vi.fn(),
        orderBy: vi.fn(),
        limit: vi.fn(),
        // oxlint-disable-next-line unicorn/no-thenable -- Drizzle's query builder is itself thenable; the mock must await like the real one.
        then: (
          resolve: (rows: unknown[]) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(rows).then(resolve, reject),
      };
      chain.from.mockReturnValue(chain);
      chain.innerJoin.mockReturnValue(chain);
      chain.where.mockReturnValue(chain);
      chain.orderBy.mockReturnValue(chain);
      chain.limit.mockReturnValue(chain);
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

    const txDelete = vi.fn(() => ({
      where: vi.fn().mockResolvedValue([]),
    }));
    const txInsertValues = vi.fn(() => ({
      onConflictDoNothing: vi.fn().mockResolvedValue([]),
    }));
    const txInsert = vi.fn(() => ({ values: txInsertValues }));
    const transaction = vi.fn(
      async (
        cb: (tx: {
          delete: typeof txDelete;
          insert: typeof txInsert;
        }) => Promise<unknown>,
      ) => cb({ delete: txDelete, insert: txInsert }),
    );

    return {
      mockDbSelectFn: selectFn,
      mockTransaction: transaction,
      mockTxDelete: txDelete,
      mockTxInsertValues: txInsertValues,
    };
  });

vi.mock("@calibra-facil/db", () => ({
  db: {
    select: mockDbSelectFn,
    transaction: mockTransaction,
  },
}));

vi.mock("@calibra-facil/db/schema", () => ({
  calibrationJob: {
    id: "j_id",
    jobId: "j_jobId",
    status: "j_status",
    approvedAt: "j_approvedAt",
    performedAt: "j_performedAt",
    supersededById: "j_supersededById",
    customerId: "j_customerId",
    organizationId: "j_orgId",
  },
  customer: { id: "c_id", name: "c_name", email: "c_email" },
  jobStandard: {
    jobId: "js_jobId",
    standardId: "js_standardId",
  },
  ootNotification: { jobId: "n_jobId", recallId: "n_recallId" },
  standardRecall: { id: "sr_id", standardId: "sr_standardId" },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...original,
    eq: (_c: unknown, _v: unknown) => ({ _op: "eq" }),
    and: (..._a: unknown[]) => ({ _op: "and" }),
    gte: (_c: unknown, _v: unknown) => ({ _op: "gte" }),
    lte: (_c: unknown, _v: unknown) => ({ _op: "lte" }),
    desc: (_c: unknown) => ({ _op: "desc" }),
    inArray: (_c: unknown, _v: unknown) => ({ _op: "inArray" }),
  };
});

import {
  findImpactedCertificates,
  syncJobStandardLinks,
} from "./job-standards";

function enqueueSelects(...rows: unknown[][]) {
  mockDbSelectFn._reset();
  for (const r of rows) mockDbSelectFn._queue.push(r);
}

function impactedRow(overrides: Record<string, unknown> = {}) {
  return {
    jobId: 1,
    certificateNumber: "CAL-2026-0001",
    status: "APPROVED",
    approvedAt: new Date("2026-03-01T12:00:00Z"),
    performedAt: new Date("2026-02-28T12:00:00Z"),
    supersededById: null,
    customerId: 10,
    customerName: "Cliente A",
    customerEmail: "a@cliente.com",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDbSelectFn._reset();
});

describe("syncJobStandardLinks", () => {
  it("keeps existing links untouched when the snapshot is undefined", async () => {
    await syncJobStandardLinks(1, undefined);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("clears links when the snapshot is null and inserts nothing", async () => {
    await syncJobStandardLinks(1, null);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockTxDelete).toHaveBeenCalledTimes(1);
    expect(mockTxInsertValues).not.toHaveBeenCalled();
  });

  it("rewrites links, deduplicating repeated standard ids", async () => {
    const snapshotEntry = (id: number) => ({
      id,
      name: `P${id}`,
      certificateNumber: "C",
      calibrationDate: new Date(),
      nextCalibrationDate: null,
      uncertainty: null,
      uncertaintyUnit: null,
      coverageFactor: 2,
      distribution: "normal" as const,
      drift: null,
      certifiedValues: null,
    });
    await syncJobStandardLinks(7, [
      snapshotEntry(5),
      snapshotEntry(5),
      snapshotEntry(9),
    ]);

    expect(mockTxDelete).toHaveBeenCalledTimes(1);
    const values = mockTxInsertValues.mock.calls[0]?.[0];
    expect(values).toHaveLength(2);
    expect(values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ jobId: 7, standardId: 5 }),
        expect.objectContaining({ jobId: 7, standardId: 9 }),
      ]),
    );
  });

  it("never propagates a database failure (derived data)", async () => {
    mockTransaction.mockRejectedValueOnce(new Error("db down"));
    await expect(syncJobStandardLinks(1, null)).resolves.toBeUndefined();
  });
});

describe("findImpactedCertificates", () => {
  const INPUT = {
    standardId: 3,
    organizationId: "org-1",
    from: new Date("2026-01-01T00:00:00Z"),
    to: new Date("2026-07-01T00:00:00Z"),
  };

  it("returns an empty list when no jobs relied on the standard", async () => {
    enqueueSelects([]);
    const result = await findImpactedCertificates(INPUT);
    expect(result).toEqual([]);
  });

  it("collapses the amendment chain when the replacement is in the impacted set", async () => {
    // Kept row (jobId 2) has no supersededById → replacements query skipped;
    // second queued result is the already-notified query.
    enqueueSelects(
      [
        impactedRow({ jobId: 1, status: "SUPERSEDED", supersededById: 2 }),
        impactedRow({ jobId: 2, certificateNumber: "CAL-2026-0001-R1" }),
      ],
      [],
    );

    const result = await findImpactedCertificates(INPUT);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      jobId: 2,
      certificateNumber: "CAL-2026-0001-R1",
    });
  });

  it("keeps a superseded original whose replacement is outside the set, annotated with the replacement identity", async () => {
    enqueueSelects(
      [impactedRow({ jobId: 1, status: "SUPERSEDED", supersededById: 99 })],
      [{ id: 99, jobId: "CAL-2026-0099" }],
      [],
    );

    const result = await findImpactedCertificates(INPUT);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      jobId: 1,
      supersededByJobId: 99,
      supersededByCertificateNumber: "CAL-2026-0099",
    });
  });

  it("flags certificates already notified in a recall of this standard", async () => {
    // No superseded rows kept → the replacements query is skipped entirely,
    // so the second queued result feeds the already-notified query.
    enqueueSelects(
      [impactedRow({ jobId: 1 }), impactedRow({ jobId: 2 })],
      [{ jobId: 2 }],
    );

    const result = await findImpactedCertificates(INPUT);

    expect(result.find((row) => row.jobId === 1)?.alreadyNotified).toBe(false);
    expect(result.find((row) => row.jobId === 2)?.alreadyNotified).toBe(true);
    expect(result.find((row) => row.jobId === 1)?.customer).toEqual({
      id: 10,
      name: "Cliente A",
      email: "a@cliente.com",
    });
  });
});
