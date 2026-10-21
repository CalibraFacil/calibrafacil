import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  execute: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
}));

vi.mock("./db.js", () => ({
  db: dbMock,
}));

import {
  claimQueueJobs,
  completeQueueJob,
  enqueueQueueJob,
  failQueueJob,
  releaseStaleQueueJobs,
} from "./queue.js";

function mockSelectJob(job: { attempts: number; maxAttempts: number } | null) {
  const limit = vi.fn().mockResolvedValue(job ? [job] : []);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  dbMock.select.mockReturnValue({ from });
  return { from, where, limit };
}

function mockUpdate(rows: Array<{ id: number }> = [{ id: 7 }]) {
  const returning = vi.fn().mockResolvedValue(rows);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  dbMock.update.mockReturnValue({ set });
  return { set, where, returning };
}

describe("Postgres queue helpers", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("enqueues queue messages and returns the job id", async () => {
    dbMock.execute.mockResolvedValue({ rows: [{ id: 42 }] });

    await expect(
      enqueueQueueJob({ type: "LABEL", jobId: 123, userId: "user_1" }),
    ).resolves.toBe(42);

    expect(dbMock.execute).toHaveBeenCalledOnce();
  });

  it("claims available jobs for a worker", async () => {
    dbMock.execute.mockResolvedValue({
      rows: [
        {
          id: 7,
          type: "CERTIFICATE",
          payload: { jobId: 123, userId: "user_1" },
          attempts: 1,
          maxAttempts: 3,
        },
      ],
    });

    await expect(claimQueueJobs("worker-a", 10)).resolves.toEqual([
      {
        id: 7,
        type: "CERTIFICATE",
        payload: { jobId: 123, userId: "user_1" },
        attempts: 1,
        maxAttempts: 3,
      },
    ]);
  });

  it("marks completion idempotently", async () => {
    const { set } = mockUpdate();

    await completeQueueJob(7, "worker-a");
    await completeQueueJob(7, "worker-a");

    expect(set).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "COMPLETED",
        lockedBy: null,
        lockedAt: null,
        lastError: null,
      }),
    );
  });

  it("REQ-QFENCE-001 completion that matches no owned PROCESSING row is a logged no-op returning false", async () => {
    mockUpdate([]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(completeQueueJob(7, "worker-a")).resolves.toBe(false);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("fenced out"));
    warn.mockRestore();
  });

  it("REQ-QFENCE-002 failure for a row the worker no longer owns writes nothing and returns false", async () => {
    mockSelectJob(null);
    const { set } = mockUpdate();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(failQueueJob(7, "worker-a", "late")).resolves.toBe(false);

    expect(set).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("fenced out"));
    warn.mockRestore();
  });

  it("REQ-QFENCE-002 failure whose lease is reclaimed between the read and the write is also a no-op", async () => {
    mockSelectJob({ attempts: 1, maxAttempts: 3 });
    mockUpdate([]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(failQueueJob(7, "worker-a", "late")).resolves.toBe(false);

    warn.mockRestore();
  });

  it("REQ-QFENCE-003 the lock holder's completion and failure report they applied", async () => {
    mockUpdate();
    await expect(completeQueueJob(7, "worker-a")).resolves.toBe(true);

    mockSelectJob({ attempts: 1, maxAttempts: 3 });
    mockUpdate();
    await expect(failQueueJob(7, "worker-a", "boom")).resolves.toBe(true);
  });

  it("releases failed jobs for retry with backoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00.000Z"));
    mockSelectJob({ attempts: 1, maxAttempts: 3 });
    const { set } = mockUpdate();

    await failQueueJob(7, "worker-a", new Error("temporary failure"));

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "PENDING",
        availableAt: new Date("2026-05-01T00:00:05.000Z"),
        lockedBy: null,
        lockedAt: null,
        lastError: "temporary failure",
      }),
    );
  });

  it("marks exhausted jobs as failed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00.000Z"));
    mockSelectJob({ attempts: 3, maxAttempts: 3 });
    const { set } = mockUpdate();

    await failQueueJob(7, "worker-a", "permanent failure");

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "FAILED",
        availableAt: new Date("2026-05-01T00:00:00.000Z"),
        lockedBy: null,
        lockedAt: null,
        lastError: "permanent failure",
      }),
    );
  });

  it("releases stale processing jobs", async () => {
    dbMock.execute.mockResolvedValue({ rows: [] });

    await releaseStaleQueueJobs(60_000);

    expect(dbMock.execute).toHaveBeenCalledOnce();
  });

  it("REQ-QDL-001 splits the reclaimed rows into released (PENDING) and dead-lettered (FAILED)", async () => {
    dbMock.execute.mockResolvedValue({
      rows: [
        {
          id: 1,
          type: "CERTIFICATE",
          payload: { jobId: 9 },
          status: "PENDING",
        },
        {
          id: 2,
          type: "CERTIFICATE",
          payload: { type: "CERTIFICATE", jobId: 10, userId: "user_1" },
          status: "FAILED",
        },
      ],
    });

    await expect(releaseStaleQueueJobs(60_000)).resolves.toEqual({
      released: 1,
      deadLettered: [
        {
          id: 2,
          type: "CERTIFICATE",
          payload: { type: "CERTIFICATE", jobId: 10, userId: "user_1" },
        },
      ],
    });
  });
});
