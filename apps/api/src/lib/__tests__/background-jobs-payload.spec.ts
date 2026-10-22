import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  enqueueQueueJob: vi.fn(),
  processBackgroundJob: vi.fn(),
}));

vi.mock("@vercel/queue", () => ({ send: mocks.send }));

vi.mock("@calibra-facil/db/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calibra-facil/db/queue")>()),
  enqueueQueueJob: mocks.enqueueQueueJob,
}));

vi.mock("../worker-modules", () => ({
  importWorkerModule: async () => ({
    processBackgroundJob: mocks.processBackgroundJob,
  }),
}));

vi.mock("../runtime-env", () => ({
  createWorkerRuntimeEnv: vi.fn(() => ({})),
}));

import { enqueueBackgroundJob } from "../background-jobs";

const savedMode = process.env.BACKGROUND_JOBS_MODE;

describe("enqueueBackgroundJob validates its payload (REQ-Q-2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enqueueQueueJob.mockResolvedValue(42);
    mocks.send.mockResolvedValue({ messageId: "vq-1" });
  });

  afterEach(() => {
    if (savedMode === undefined) delete process.env.BACKGROUND_JOBS_MODE;
    else process.env.BACKGROUND_JOBS_MODE = savedMode;
  });

  it.each(["queue", "vercel"])(
    "REQ-Q-2 refuses a payload that fails its schema before any dispatch (mode %s)",
    async (mode) => {
      process.env.BACKGROUND_JOBS_MODE = mode;

      await expect(
        // @ts-expect-error -- jobId must be a number: the parameter is the typed union
        enqueueBackgroundJob({ type: "LABEL", jobId: "7", userId: "u" }),
      ).rejects.toThrow(/invalid background job.*jobId/i);

      expect(mocks.enqueueQueueJob).not.toHaveBeenCalled();
      expect(mocks.send).not.toHaveBeenCalled();
    },
  );

  it("REQ-Q-2 refuses an unknown job type", async () => {
    process.env.BACKGROUND_JOBS_MODE = "queue";

    await expect(
      // @ts-expect-error -- not a member of the union
      enqueueBackgroundJob({ type: "SHIP_PIZZA" }),
    ).rejects.toThrow(/SHIP_PIZZA/);

    expect(mocks.enqueueQueueJob).not.toHaveBeenCalled();
  });

  it("REQ-Q-2 hands the parsed message to the queue", async () => {
    process.env.BACKGROUND_JOBS_MODE = "queue";

    await enqueueBackgroundJob({
      type: "AUDIT_PACK",
      exportId: 3,
      userId: "u",
    });

    expect(mocks.enqueueQueueJob).toHaveBeenCalledWith({
      type: "AUDIT_PACK",
      exportId: 3,
      userId: "u",
    });
  });
});
