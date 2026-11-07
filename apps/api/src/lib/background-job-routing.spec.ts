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

  it("keeps the cron-only messages and Conta Azul syncs in this process", () => {
    vi.stubEnv("BACKGROUND_JOBS_MODE", "queue");
    expect(routesToDatabaseQueue({ type: "SCHEDULED_NOTIFICATIONS" })).toBe(
      false,
    );
    expect(
      routesToDatabaseQueue({
        type: "INTEGRATION_SYNC",
        provider: "conta_azul",
        integrationId: "int-1",
        organizationId: "org-1",
        runId: "run-1",
        target: "customer",
        limit: 50,
        trigger: "manual",
      }),
    ).toBe(false);
  });
});
