import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("@calibra-facil/db", () => ({
  db: { execute },
}));

const { runCron } = await import("../../../vercel-src/cron/cron-run");

// A lease UPDATE that returns one row = lease acquired; zero rows = held by a
// concurrent run.
function leaseAcquired() {
  execute.mockResolvedValue({ rows: [{ job: "demo" }] });
}
function leaseHeld() {
  // INSERT returns nothing; the acquire UPDATE returns no rows.
  execute
    .mockResolvedValueOnce({ rows: [] }) // INSERT ... ON CONFLICT DO NOTHING
    .mockResolvedValueOnce({ rows: [] }); // acquire UPDATE -> not acquired
}

beforeEach(() => {
  execute.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runCron", () => {
  it("runs the task and returns its value on success", async () => {
    leaseAcquired();
    const task = vi.fn().mockResolvedValue({ enqueued: true });

    const response = await runCron("demo", {}, task);

    expect(task).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ enqueued: true });
    // INSERT + acquire UPDATE + success heartbeat UPDATE = 3 writes.
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("skips the task (200) when another run holds the lease", async () => {
    leaseHeld();
    const task = vi.fn();

    const response = await runCron("demo", {}, task);

    expect(task).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ skipped: true });
  });

  it("returns a structured 500 when the task throws, and records the error", async () => {
    leaseAcquired();
    const task = vi.fn().mockRejectedValue(new Error("boom"));

    const response = await runCron("demo", {}, task);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "boom",
    });
    // INSERT + acquire UPDATE + error heartbeat UPDATE = 3 writes.
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("returns 500 when the `failed` predicate flags the result", async () => {
    leaseAcquired();
    const task = vi.fn().mockResolvedValue({ allFailed: true });

    const response = await runCron(
      "demo",
      {
        failed: (r) => Boolean(r && typeof r === "object" && "allFailed" in r),
      },
      task,
    );

    expect(response.status).toBe(500);
  });

  it("FAILS OPEN: runs the task even if the lease table is unavailable", async () => {
    // Every db call rejects (e.g. cron_run missing — migration not yet applied).
    execute.mockRejectedValue(new Error('relation "cron_run" does not exist'));
    const task = vi.fn().mockResolvedValue({ ok: true });

    const response = await runCron("demo", {}, task);

    expect(task).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
