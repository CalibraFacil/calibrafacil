import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackgroundJobMessage } from "@calibra-facil/schemas";

const mocks = vi.hoisted(() => ({
  enqueueQueueJob: vi.fn(),
  processBackgroundJob: vi.fn(),
}));

vi.mock("@calibra-facil/db/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calibra-facil/db/queue")>()),
  enqueueQueueJob: mocks.enqueueQueueJob,
}));

// The in-process runners load these lazily.
vi.mock("@calibra-facil/jobs-core", () => ({
  processBackgroundJob: mocks.processBackgroundJob,
}));

vi.mock("../runtime-env", () => ({
  createWorkerRuntimeEnv: vi.fn(() => ({})),
}));

import { enqueueBackgroundJob } from "../background-jobs";

const savedMode = process.env.BACKGROUND_JOBS_MODE;

// A queue job used as the sample for the routing rules below; the routing under
// test is job-type agnostic.
const auditPackMessage: BackgroundJobMessage = {
  type: "AUDIT_PACK",
  exportId: 1,
  userId: "user-1",
};

// CERTIFICATE job dispatched with `type` omitted (the optional-type variant).
const certificateMessage: BackgroundJobMessage = {
  jobId: 10,
  userId: "user-1",
};

const serviceOrderQuoteMessage: BackgroundJobMessage = {
  type: "SERVICE_ORDER_QUOTE",
  serviceOrderId: 5,
  userId: "user-1",
};

function restoreMode() {
  if (savedMode === undefined) delete process.env.BACKGROUND_JOBS_MODE;
  else process.env.BACKGROUND_JOBS_MODE = savedMode;
}

describe("enqueueBackgroundJob — database queue mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BACKGROUND_JOBS_MODE = "queue";
    mocks.enqueueQueueJob.mockResolvedValue(42);
    mocks.processBackgroundJob.mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    restoreMode();
    vi.restoreAllMocks();
  });

  it("writes every queue job to app_queue_job", async () => {
    for (const message of [
      auditPackMessage,
      certificateMessage,
      serviceOrderQuoteMessage,
    ]) {
      const result = await enqueueBackgroundJob(message);
      expect(result.messageId).toBe("app-queue-42");
      expect(mocks.enqueueQueueJob).toHaveBeenLastCalledWith(message);
    }
    expect(mocks.processBackgroundJob).not.toHaveBeenCalled();
  });

  it("runs the cron-only messages in this process", async () => {
    const message: BackgroundJobMessage = { type: "SCHEDULED_NOTIFICATIONS" };

    const result = await enqueueBackgroundJob(message);

    expect(result.messageId).toMatch(/^local-/);
    expect(mocks.enqueueQueueJob).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(mocks.processBackgroundJob).toHaveBeenCalledWith(
        expect.anything(),
        message,
      ),
    );
  });

  it("refuses a Conta Azul sync: it runs through dispatchContaAzulSync", async () => {
    const message: BackgroundJobMessage = {
      type: "INTEGRATION_SYNC",
      provider: "conta_azul",
      integrationId: "integration-1",
      organizationId: "org-1",
      runId: "run-1",
      target: "customer",
      limit: 50,
      trigger: "manual",
    };

    await expect(enqueueBackgroundJob(message)).rejects.toThrow(
      "dispatchContaAzulSync",
    );
    expect(mocks.enqueueQueueJob).not.toHaveBeenCalled();
  });
});

describe("enqueueBackgroundJob — local mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BACKGROUND_JOBS_MODE = "local";
    mocks.processBackgroundJob.mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    restoreMode();
    vi.restoreAllMocks();
  });

  it("runs every job in this process and writes nothing to the queue", async () => {
    const result = await enqueueBackgroundJob(auditPackMessage);

    expect(result.messageId).toMatch(/^local-/);
    expect(mocks.enqueueQueueJob).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(mocks.processBackgroundJob).toHaveBeenCalledWith(
        expect.anything(),
        auditPackMessage,
      ),
    );
  });

  it("logs a failed local job instead of failing the enqueue", async () => {
    mocks.processBackgroundJob.mockRejectedValue(new Error("render failed"));

    await expect(enqueueBackgroundJob(auditPackMessage)).resolves.toMatchObject(
      { messageId: expect.stringMatching(/^local-/) },
    );
    await vi.waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        "[BackgroundJobs] Local job failed",
        expect.objectContaining({ message: auditPackMessage }),
      ),
    );
  });
});

describe("enqueueBackgroundJob — removed inline mode", () => {
  afterEach(restoreMode);

  it("refuses a configuration that still asks for `inline`", async () => {
    process.env.BACKGROUND_JOBS_MODE = "inline";

    await expect(enqueueBackgroundJob(auditPackMessage)).rejects.toThrow(
      /BACKGROUND_JOBS_MODE/,
    );
    expect(mocks.processBackgroundJob).not.toHaveBeenCalled();
  });
});
