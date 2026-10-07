import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Cron } from "croner";

import { readCronEntries, startCronScheduler } from "./cron-scheduler";

const vercelConfig: unknown = JSON.parse(
  readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"),
);

let jobs: Cron[] = [];

afterEach(() => {
  for (const job of jobs) job.stop();
  jobs = [];
});

describe("readCronEntries", () => {
  it("reads every cron job vercel.json declares", () => {
    const entries = readCronEntries(vercelConfig);

    expect(entries.length).toBeGreaterThan(0);
    expect(entries).toContainEqual({
      path: "/api/cron/queue-backstop",
      schedule: "*/30 * * * *",
    });
  });

  it("ignores anything that is not a /api/cron/* job", () => {
    expect(readCronEntries(null)).toEqual([]);
    expect(
      readCronEntries({
        crons: [
          { path: "/api/other", schedule: "* * * * *" },
          { path: "/api/cron/x" },
          "nope",
        ],
      }),
    ).toEqual([]);
  });
});

describe("startCronScheduler", () => {
  it("schedules every vercel.json job with a valid pattern", () => {
    jobs = startCronScheduler({
      entries: readCronEntries(vercelConfig),
      dispatch: vi.fn(),
      secret: "s",
    });

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
