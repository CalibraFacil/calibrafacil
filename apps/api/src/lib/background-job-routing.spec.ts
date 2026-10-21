import { afterEach, describe, expect, it, vi } from "vitest";
import { routesToDatabaseQueue } from "./background-job-routing";

const certificate = { jobId: 1, userId: "u" } as const;

describe("routesToDatabaseQueue", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["queue", "", true],
    ["local", "", false],
    ["inline", "", false],
    ["vercel", "", false],
    // Vercel mode only uses app_queue_job when the document worker is wired in
    // for CERTIFICATE jobs.
    ["vercel", "https://worker.test", false],
  ])("mode %s, worker url %j -> %s", (mode, workerUrl, expected) => {
    vi.stubEnv("BACKGROUND_JOBS_MODE", mode);
    vi.stubEnv("DOCUMENT_WORKER_URL", workerUrl);
    vi.stubEnv("DOCUMENT_WORKER_JOB_TYPES", "");
    expect(routesToDatabaseQueue(certificate)).toBe(expected);
  });

  it("vercel mode with the worker allowlisting CERTIFICATE routes to app_queue_job", () => {
    vi.stubEnv("BACKGROUND_JOBS_MODE", "vercel");
    vi.stubEnv("DOCUMENT_WORKER_URL", "https://worker.test");
    vi.stubEnv("DOCUMENT_WORKER_JOB_TYPES", "CERTIFICATE");
    expect(routesToDatabaseQueue(certificate)).toBe(true);
  });
});
