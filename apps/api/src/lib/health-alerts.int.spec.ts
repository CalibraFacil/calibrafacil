/**
 * health-alerts.int.spec.ts — the operator alerts of /api/health against a real
 * Postgres (roadmap 2 G2): cron heartbeats in cron_run and dead letters in
 * app_queue_job.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@calibra-facil/db";
import { appQueueJob, cronRun } from "@calibra-facil/db/schema";
import { truncateAll } from "../../test/integration/db";
import { readHealthAlerts } from "./health-alerts";

const NOW = new Date("2026-10-27T12:00:00.000Z");

describe("readHealthAlerts (roadmap 2 G2)", () => {
  beforeEach(async () => {
    await truncateAll();
    await db.delete(cronRun);
  });

  it("is ok with fresh heartbeats and no dead letters", async () => {
    await db.insert(cronRun).values({
      job: "queue-backstop",
      lastRunAt: new Date(NOW.getTime() - 5 * 60_000),
      lastSuccessAt: new Date(NOW.getTime() - 5 * 60_000),
      lastStatus: "ok",
    });

    expect(await readHealthAlerts(NOW)).toEqual({
      ok: true,
      staleCrons: [],
      failingCrons: [],
      deadLetters: 0,
    });
  });

  it("reports a stale job, a failing job and dead letters", async () => {
    await db.insert(cronRun).values([
      {
        job: "queue-backstop",
        lastRunAt: new Date(NOW.getTime() - 3 * 60 * 60_000),
        lastSuccessAt: new Date(NOW.getTime() - 3 * 60 * 60_000),
        lastStatus: "ok",
      },
      {
        job: "certificate-drift",
        lastRunAt: new Date(NOW.getTime() - 60_000),
        lastSuccessAt: new Date(NOW.getTime() - 2 * 60 * 60_000),
        lastStatus: "error",
        consecutiveFailures: 3,
      },
    ]);
    await db.insert(appQueueJob).values({
      type: "PDF_GENERATION",
      payload: { type: "PDF_GENERATION", jobId: 1 },
      status: "FAILED",
    });

    expect(await readHealthAlerts(NOW)).toEqual({
      ok: false,
      staleCrons: ["queue-backstop"],
      failingCrons: ["certificate-drift"],
      deadLetters: 1,
    });
  });
});
