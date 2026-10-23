import { afterEach, describe, expect, it, vi } from "vitest";
import type { Cron } from "croner";

import { JOB_HANDLERS } from "../cron/dispatch";
import { CRON_ENTRIES, startCronScheduler } from "./cron-scheduler";

let jobs: Cron[] = [];

afterEach(() => {
  for (const job of jobs) job.stop();
  jobs = [];
});

function jobName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? "";
}

describe("CRON_ENTRIES", () => {
  it("schedules exactly the jobs the cron dispatcher can run", () => {
    // A scheduled path without a handler would 404 on every tick; a handler
    // without a schedule would never run.
    expect(CRON_ENTRIES.map((entry) => jobName(entry.path)).toSorted()).toEqual(
      Object.keys(JOB_HANDLERS).toSorted(),
    );
  });

  it("lists every path under /api/cron/ once", () => {
    const paths = CRON_ENTRIES.map((entry) => entry.path);

    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) expect(path).toMatch(/^\/api\/cron\/[a-z-]+$/);
  });

  it("keeps the cadence of every job", () => {
    expect(
      Object.fromEntries(CRON_ENTRIES.map((e) => [e.path, e.schedule])),
    ).toEqual({
      "/api/cron/integrations": "*/30 * * * *",
      "/api/cron/notifications": "0 8 * * *",
      "/api/cron/portal-digest": "0 9 * * *",
      "/api/cron/auth-maintenance": "30 4 * * 1",
      "/api/cron/service-order-emails": "*/30 * * * *",
      "/api/cron/oot-emails": "*/30 * * * *",
      "/api/cron/queue-backstop": "*/30 * * * *",
      "/api/cron/spc-recompute": "0 3 * * *",
      "/api/cron/email-domain-health": "30 3 * * *",
      "/api/cron/certificate-drift": "0 6 * * *",
      "/api/cron/records-purge": "0 5 * * 0",
      "/api/cron/sync-change-log-purge": "15 4 * * *",
    });
  });
});

describe("startCronScheduler", () => {
  it("schedules every job with a valid pattern", () => {
    jobs = startCronScheduler({
      entries: CRON_ENTRIES,
      dispatch: vi.fn(),
      secret: "s",
    });

    expect(jobs).toHaveLength(CRON_ENTRIES.length);
    for (const job of jobs) {
      expect(job.nextRun()).toBeInstanceOf(Date);
    }
  });

  it("runs a job through the dispatcher with the cron secret", async () => {
    const dispatch = vi.fn(async () => new Response(null, { status: 200 }));
    vi.spyOn(console, "info").mockImplementation(() => {});

    jobs = startCronScheduler({
      entries: [{ path: "/api/cron/queue-backstop", schedule: "0 0 1 1 *" }],
      dispatch,
      secret: "cron-secret",
    });
    await jobs[0]?.trigger();

    expect(dispatch).toHaveBeenCalledTimes(1);
    const request: Request = dispatch.mock.calls[0]?.[0];
    expect(new URL(request.url).pathname).toBe("/api/cron/queue-backstop");
    expect(request.headers.get("authorization")).toBe("Bearer cron-secret");
  });
});
