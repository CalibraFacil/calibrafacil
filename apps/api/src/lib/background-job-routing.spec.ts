import { afterEach, describe, expect, it, vi } from "vitest";
import { routesToDatabaseQueue } from "./background-job-routing";

const certificate = { jobId: 1, userId: "u" } as const;

describe("routesToDatabaseQueue", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["queue", true],
    ["local", false],
  ])("mode %s -> %s", (mode, expected) => {
    vi.stubEnv("BACKGROUND_JOBS_MODE", mode);
    expect(routesToDatabaseQueue(certificate)).toBe(expected);
  });

  it("defaults to the in-process mode", () => {
    vi.stubEnv("BACKGROUND_JOBS_MODE", "");
    expect(routesToDatabaseQueue(certificate)).toBe(false);
  });

  it("keeps the cron-only messages in this process", () => {
    vi.stubEnv("BACKGROUND_JOBS_MODE", "queue");
    expect(routesToDatabaseQueue({ type: "SCHEDULED_NOTIFICATIONS" })).toBe(
      false,
    );
  });
});
