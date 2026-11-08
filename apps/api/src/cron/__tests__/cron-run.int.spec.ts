/**
 * cron-run.int.spec.ts: the lease and heartbeat of `runCron` against a real
 * Postgres. The state that matters (`locked_until`, `last_status`,
 * `consecutive_failures`) lives in the `cron_run` row, so each case reads it back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@calibra-facil/db";
import { cronRun } from "@calibra-facil/db/schema";
import { eq, sql } from "drizzle-orm";
import { truncateAll } from "../../../test/integration/db";
import { runCron } from "../cron-run";

async function readRun(job: string) {
  const [row] = await db.select().from(cronRun).where(eq(cronRun.job, job));
  return row;
}

beforeEach(async () => {
  await truncateAll();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runCron against cron_run", () => {
  it("runs the task, returns its value and records a success heartbeat with the lease released", async () => {
    const task = vi.fn().mockResolvedValue({ enqueued: true });

    const response = await runCron("demo", {}, task);

    expect(task).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ enqueued: true });
    const row = await readRun("demo");
    expect(row).toMatchObject({
      lastStatus: "ok",
      lastError: null,
      consecutiveFailures: 0,
      lockedUntil: null,
    });
    expect(row?.lastSuccessAt).toBeInstanceOf(Date);
    expect(row?.lastRunAt).toBeInstanceOf(Date);
  });

  it("holds the lease while the task runs, so a concurrent run is skipped without touching the row", async () => {
    let inner: Response | undefined;
    const slow = vi.fn(async () => {
      const second = vi.fn();
      inner = await runCron("demo", {}, second);
      expect(second).not.toHaveBeenCalled();
      const during = await readRun("demo");
      expect(during?.lockedUntil).toBeInstanceOf(Date);
      expect(during?.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
      return { done: true };
    });

    const outer = await runCron("demo", {}, slow);

    expect(outer.status).toBe(200);
    expect(inner?.status).toBe(200);
    await expect(inner?.json()).resolves.toMatchObject({ skipped: true });
    // The skipped run did not record an outcome: only the owner's success.
    expect(await readRun("demo")).toMatchObject({
      lastStatus: "ok",
      lockedUntil: null,
    });
  });

  it("takes over a lease whose time has expired", async () => {
    await db.insert(cronRun).values({
      job: "demo",
      lockedUntil: new Date(Date.now() - 60_000),
    });
    const task = vi.fn().mockResolvedValue({ ok: true });

    const response = await runCron("demo", {}, task);

    expect(task).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
  });

  it("returns a structured 500 when the task throws and counts the consecutive failure", async () => {
    const failing = () => Promise.reject(new Error("boom"));

    const first = await runCron("demo", {}, failing);
    const second = await runCron("demo", {}, failing);

    expect(first.status).toBe(500);
    await expect(first.json()).resolves.toEqual({ ok: false, error: "boom" });
    expect(second.status).toBe(500);
    expect(await readRun("demo")).toMatchObject({
      lastStatus: "error",
      lastError: "boom",
      consecutiveFailures: 2,
      lockedUntil: null,
    });
  });

  it("resets the failure count on the next success", async () => {
    await runCron("demo", {}, () => Promise.reject(new Error("boom")));

    await runCron("demo", {}, () => Promise.resolve({ ok: true }));

    expect(await readRun("demo")).toMatchObject({
      lastStatus: "ok",
      lastError: null,
      consecutiveFailures: 0,
    });
  });

  it("returns 500 and records an error when the `failed` predicate flags the result", async () => {
    const response = await runCron(
      "demo",
      {
        failed: (r) => Boolean(r && typeof r === "object" && "allFailed" in r),
      },
      () => Promise.resolve({ allFailed: true }),
    );

    expect(response.status).toBe(500);
    expect(await readRun("demo")).toMatchObject({
      lastStatus: "error",
      consecutiveFailures: 1,
    });
  });

  it("keeps jobs apart: a lease on one job does not block another", async () => {
    let other: Response | undefined;
    await runCron("job-a", {}, async () => {
      other = await runCron("job-b", {}, () => Promise.resolve({ b: true }));
      return { a: true };
    });

    expect(other?.status).toBe(200);
    await expect(other?.json()).resolves.toEqual({ b: true });
  });

  it("FAILS OPEN: runs the task even if the lease table is unavailable", async () => {
    // cron_run missing (migration not yet applied): move the table out of the way.
    await db.execute(sql`ALTER TABLE cron_run RENAME TO cron_run_away`);
    try {
      const task = vi.fn().mockResolvedValue({ ok: true });

      const response = await runCron("demo", {}, task);

      expect(task).toHaveBeenCalledOnce();
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
    } finally {
      await db.execute(sql`ALTER TABLE cron_run_away RENAME TO cron_run`);
    }
  });
});
