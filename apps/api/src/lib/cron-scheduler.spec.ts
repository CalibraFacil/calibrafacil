import { afterEach, describe, expect, it, vi } from "vitest";
import type { Cron } from "croner";

import { createInFlightRuns, startCronScheduler } from "./cron-scheduler";
import { CRON_ENTRIES } from "../cron/schedule";

let jobs: Cron[] = [];

afterEach(() => {
  for (const job of jobs) job.stop();
  jobs = [];
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

  it("records a running job so a shutdown can wait for it", async () => {
    let finish: () => void = () => {};
    const dispatch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = () => resolve(new Response(null, { status: 200 }));
        }),
    );
    vi.spyOn(console, "info").mockImplementation(() => {});
    const inFlight = createInFlightRuns();

    jobs = startCronScheduler({
      entries: [{ path: "/api/cron/queue-backstop", schedule: "0 0 1 1 *" }],
      dispatch,
      secret: undefined,
      inFlight,
    });
    const run = jobs[0]?.trigger();
    let idle = false;
    const waiting = inFlight.idle().then(() => {
      idle = true;
    });
    await Promise.resolve();
    expect(idle).toBe(false);

    finish();
    await run;
    await waiting;

    expect(idle).toBe(true);
  });
});
