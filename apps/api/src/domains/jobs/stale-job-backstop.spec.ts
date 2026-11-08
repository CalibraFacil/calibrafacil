import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Unit tier for the orphan-job backstop decision logic. The DB reads are
// injected so this suite never touches a real DB — the integration proof lives in
// stale-job-backstop.int.spec.ts against a real Postgres.
//
// runStaleJobBackstop is the periodic backstop: it re-claims expired leases
// independently of any worker or NEW enqueue, so a job stuck in GENERATING_PDF /
// PENDING past its lease is recovered on a timer.

import {
  runStaleJobBackstop,
  type StaleJobBackstopDeps,
} from "./stale-job-backstop";

const SAVED = {
  QUEUE_STALE_AFTER_MS: process.env.QUEUE_STALE_AFTER_MS,
  STUCK_RENDER_AFTER_MS: process.env.STUCK_RENDER_AFTER_MS,
};

function reclaimed(released: number, deadLettered: unknown[] = []) {
  return { released, deadLettered };
}

const DEAD_LETTERED_ROW = {
  id: 41,
  type: "CERTIFICATE" as const,
  payload: { type: "CERTIFICATE", jobId: 7, userId: "user-1" },
};

/** Every dep but the two thresholds, so the env-driven defaults apply. */
function depsWithoutThresholds(
  rejectStuckRenders: StaleJobBackstopDeps["rejectStuckRenders"],
): Partial<StaleJobBackstopDeps> {
  return {
    releaseStaleJobs: vi.fn(async () => reclaimed(0)),
    rejectDeadLetteredRenders: vi.fn(async () => 0),
    rejectStuckRenders,
    countRecoverableJobs: vi.fn(async () => 0),
    pruneReceipts: vi.fn(async () => 0),
  };
}

function makeDeps(
  overrides: Partial<StaleJobBackstopDeps> = {},
): StaleJobBackstopDeps {
  return {
    releaseStaleJobs: vi.fn(async () => reclaimed(0)),
    rejectDeadLetteredRenders: vi.fn(async () => 0),
    rejectStuckRenders: vi.fn(async () => 0),
    countRecoverableJobs: vi.fn(async () => 0),
    pruneReceipts: vi.fn(async () => 0),
    staleAfterMs: 10 * 60_000,
    stuckRenderAfterMs: 60 * 60_000,
    ...overrides,
  };
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.QUEUE_STALE_AFTER_MS;
  delete process.env.STUCK_RENDER_AFTER_MS;
});

afterEach(() => {
  restoreEnv("QUEUE_STALE_AFTER_MS", SAVED.QUEUE_STALE_AFTER_MS);
  restoreEnv("STUCK_RENDER_AFTER_MS", SAVED.STUCK_RENDER_AFTER_MS);
});

describe("runStaleJobBackstop (REL-03 periodic orphan-job backstop)", () => {
  it("REQ-REL-PDF-001 re-claims stale leases on a timer and counts what is claimable — no new enqueue", async () => {
    const deps = makeDeps({
      releaseStaleJobs: vi.fn(async () => reclaimed(2)),
      countRecoverableJobs: vi.fn(async () => 2),
      staleAfterMs: 10 * 60_000,
    });

    const result = await runStaleJobBackstop(deps);

    // It released the stale-locked rows using the configured lease window. It
    // NEVER enqueues — the deps surface has no enqueue at all, so a duplicate job
    // row is impossible here; the polling worker re-claims the SAME rows.
    expect(deps.releaseStaleJobs).toHaveBeenCalledWith(10 * 60_000);
    expect("enqueue" in deps).toBe(false);
    expect(result).toEqual({
      released: 2,
      deadLettered: 0,
      rejectedRenders: 0,
      stuckRendersRejected: 0,
      pending: 2,
      prunedReceipts: 0,
    });
  });

  it("REQ-REL-PDF-001 counts a job stranded in PENDING (released 0, pending > 0)", async () => {
    // releaseStaleQueueJobs only touches PROCESSING, so released is 0, but a row
    // nobody has claimed yet is still recoverable and is reported.
    const deps = makeDeps({
      releaseStaleJobs: vi.fn(async () => reclaimed(0)),
      countRecoverableJobs: vi.fn(async () => 1),
    });

    const result = await runStaleJobBackstop(deps);

    expect(result).toEqual({
      released: 0,
      deadLettered: 0,
      rejectedRenders: 0,
      stuckRendersRejected: 0,
      pending: 1,
      prunedReceipts: 0,
    });
  });

  it("defaults the stale-after window to QUEUE_STALE_AFTER_MS when not overridden", async () => {
    process.env.QUEUE_STALE_AFTER_MS = "900000";
    const releaseStaleJobs = vi.fn(async () => reclaimed(0));

    // Override only the DB reads; leave staleAfterMs to the default resolver so
    // it is read from the env.
    await runStaleJobBackstop({
      releaseStaleJobs,
      rejectDeadLetteredRenders: vi.fn(async () => 0),
      rejectStuckRenders: vi.fn(async () => 0),
      countRecoverableJobs: vi.fn(async () => 0),
      pruneReceipts: vi.fn(async () => 0),
    });

    expect(releaseStaleJobs).toHaveBeenCalledWith(900_000);
  });
});

describe("runStaleJobBackstop dead-letter orchestration (REQ-QDL-002, REQ-QDL-003)", () => {
  it("REQ-QDL-002 hands the rows the reclaim dead-lettered to the render rejection and reports the counts", async () => {
    const deps = makeDeps({
      releaseStaleJobs: vi.fn(async () => reclaimed(1, [DEAD_LETTERED_ROW])),
      rejectDeadLetteredRenders: vi.fn(async () => 1),
    });

    const result = await runStaleJobBackstop(deps);

    expect(deps.rejectDeadLetteredRenders).toHaveBeenCalledWith([
      DEAD_LETTERED_ROW,
    ]);
    expect(result).toMatchObject({
      released: 1,
      deadLettered: 1,
      rejectedRenders: 1,
    });
  });

  it("REQ-QDL-002 rejects dead-lettered renders only after the reclaim that found them", async () => {
    const order: string[] = [];
    const deps = makeDeps({
      releaseStaleJobs: vi.fn(async () => {
        order.push("release");
        return reclaimed(0, [DEAD_LETTERED_ROW]);
      }),
      rejectDeadLetteredRenders: vi.fn(async () => {
        order.push("reject-dead-lettered");
        return 1;
      }),
      rejectStuckRenders: vi.fn(async () => {
        order.push("sweep");
        return 0;
      }),
      countRecoverableJobs: vi.fn(async () => {
        order.push("count");
        return 0;
      }),
    });

    await runStaleJobBackstop(deps);

    expect(order).toEqual([
      "release",
      "reject-dead-lettered",
      "sweep",
      "count",
    ]);
  });

  it("REQ-QDL-003 sweeps stuck renders with the configured threshold and reports how many were rejected", async () => {
    const deps = makeDeps({
      rejectStuckRenders: vi.fn(async () => 2),
      stuckRenderAfterMs: 90 * 60_000,
    });

    const result = await runStaleJobBackstop(deps);

    expect(deps.rejectStuckRenders).toHaveBeenCalledWith(90 * 60_000);
    expect(result.stuckRendersRejected).toBe(2);
  });

  it("REQ-QDL-003 defaults the stuck-render threshold to 60 minutes", async () => {
    const rejectStuckRenders = vi.fn(async () => 0);

    await runStaleJobBackstop(depsWithoutThresholds(rejectStuckRenders));

    expect(rejectStuckRenders).toHaveBeenCalledWith(60 * 60_000);
  });

  it("REQ-QDL-003 reads the threshold from STUCK_RENDER_AFTER_MS", async () => {
    process.env.STUCK_RENDER_AFTER_MS = "1800000";
    const rejectStuckRenders = vi.fn(async () => 0);

    await runStaleJobBackstop(depsWithoutThresholds(rejectStuckRenders));

    expect(rejectStuckRenders).toHaveBeenCalledWith(30 * 60_000);
  });

  it("REQ-QDL-003 ignores an invalid STUCK_RENDER_AFTER_MS", async () => {
    process.env.STUCK_RENDER_AFTER_MS = "soon";
    const rejectStuckRenders = vi.fn(async () => 0);

    await runStaleJobBackstop(depsWithoutThresholds(rejectStuckRenders));

    expect(rejectStuckRenders).toHaveBeenCalledWith(60 * 60_000);
  });

  it("REQ-QDL-002 a failing render rejection never stops the reclaim, the sweep or the count", async () => {
    const deps = makeDeps({
      releaseStaleJobs: vi.fn(async () => reclaimed(1, [DEAD_LETTERED_ROW])),
      rejectDeadLetteredRenders: vi.fn(async () => {
        throw new Error("db down");
      }),
      rejectStuckRenders: vi.fn(async () => {
        throw new Error("db down");
      }),
      countRecoverableJobs: vi.fn(async () => 1),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runStaleJobBackstop(deps);

    expect(result).toMatchObject({
      released: 1,
      deadLettered: 1,
      rejectedRenders: 0,
      stuckRendersRejected: 0,
      pending: 1,
    });
  });
});
