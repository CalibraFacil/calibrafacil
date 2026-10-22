import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  execute: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
}));

vi.mock("./db.js", () => ({
  db: dbMock,
}));

import { claimQueueJobs, enqueueQueueJob, isQueueMessage } from "./queue.js";

function mockUpdate(rows: Array<{ id: number }> = [{ id: 7 }]) {
  const returning = vi.fn().mockResolvedValue(rows);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  dbMock.update.mockReturnValue({ set });
  return { set };
}

function claimedRow(id: number, payload: unknown) {
  return { id, type: "CERTIFICATE", payload, attempts: 1, maxAttempts: 3 };
}

describe("typed queue payloads (db layer)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("REQ-Q-2 enqueue refuses a payload that fails its schema, before touching the database", async () => {
    // @ts-expect-error -- jobId must be a number: the parameter is the typed union, not unknown
    const invalid = enqueueQueueJob({ type: "LABEL", jobId: "1", userId: "u" });

    await expect(invalid).rejects.toThrow(/invalid queue job.*jobId/i);
    expect(dbMock.execute).not.toHaveBeenCalled();
  });

  it("REQ-Q-2 enqueue refuses an unknown job type, and the cron-only timers", async () => {
    // @ts-expect-error -- not a member of the union
    const unknown = enqueueQueueJob({ type: "SHIP_PIZZA" });
    // @ts-expect-error -- cron-only timers are not queue jobs
    const timer = enqueueQueueJob({ type: "PORTAL_DIGEST" });

    await expect(unknown).rejects.toThrow(/SHIP_PIZZA/);
    await expect(timer).rejects.toThrow(/PORTAL_DIGEST/);
    expect(dbMock.execute).not.toHaveBeenCalled();
  });

  it("REQ-Q-2 enqueue stores the parsed payload (unknown keys stripped)", async () => {
    dbMock.execute.mockResolvedValue({ rows: [{ id: 5 }] });
    const message = {
      type: "LABEL",
      jobId: 1,
      userId: "u",
      leaked: "x",
    } as const;

    await enqueueQueueJob(message);

    const [statement] = dbMock.execute.mock.calls[0] ?? [];
    const serialized = JSON.stringify(statement?.queryChunks ?? statement);
    expect(serialized).toContain('{\\"type\\":\\"LABEL\\",\\"jobId\\":1');
    expect(serialized).not.toContain("leaked");
  });

  it("REQ-Q-3 isQueueMessage is the schema, not a shape sniff", () => {
    expect(isQueueMessage({ jobId: 1, userId: "u" })).toBe(true);
    expect(isQueueMessage({ type: "LABEL", jobId: "1", userId: "u" })).toBe(
      false,
    );
    expect(isQueueMessage({ type: "PORTAL_DIGEST" })).toBe(false);
  });

  it("REQ-Q-3 a claimed row failing its schema is dead-lettered (FAILED, with the reason) and never returned", async () => {
    const { set } = mockUpdate();
    dbMock.execute.mockResolvedValueOnce({
      rows: [
        claimedRow(1, { type: "CERTIFICATE", jobId: "x", userId: "u" }),
        claimedRow(2, { jobId: 2, userId: "u" }),
      ],
    });
    dbMock.execute.mockResolvedValueOnce({ rows: [] });

    const jobs = await claimQueueJobs("worker-a", 2);

    expect(jobs.map((job) => job.id)).toEqual([2]);
    expect(set).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "FAILED",
        lockedBy: null,
        lockedAt: null,
        lastError: expect.stringContaining("jobId"),
      }),
    );
  });

  it("REQ-Q-3 a dead-lettered row is replaced by claiming another, so the batch stays full", async () => {
    mockUpdate();
    dbMock.execute
      .mockResolvedValueOnce({ rows: [claimedRow(1, { type: "NOPE" })] })
      .mockResolvedValueOnce({
        rows: [claimedRow(2, { jobId: 2, userId: "u" })],
      });

    const jobs = await claimQueueJobs("worker-a", 1);

    expect(jobs.map((job) => job.id)).toEqual([2]);
    expect(dbMock.execute).toHaveBeenCalledTimes(2);
  });
});
