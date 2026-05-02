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

function mockUpdate() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn(() => ({ where }));
  dbMock.update.mockReturnValue({ set });
  return { set, where };
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

    await completeQueueJob(7);
    await completeQueueJob(7);

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

  it("releases failed jobs for retry with backoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00.000Z"));
    mockSelectJob({ attempts: 1, maxAttempts: 3 });
    const { set } = mockUpdate();

    await failQueueJob(7, new Error("temporary failure"));

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

    await failQueueJob(7, "permanent failure");

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
});
