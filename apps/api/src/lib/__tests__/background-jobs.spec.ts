import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackgroundJobMessage } from "@calibra-facil/shared";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  enqueueQueueJob: vi.fn(),
}));

vi.mock("@vercel/queue", () => ({
  send: mocks.send,
}));

vi.mock("@calibra-facil/db/queue", () => ({
  enqueueQueueJob: mocks.enqueueQueueJob,
}));

vi.mock("../runtime-env", () => ({
  createWorkerRuntimeEnv: vi.fn(() => ({})),
}));

import { enqueueBackgroundJob, wakeDocumentWorker } from "../background-jobs";

const DOCUMENT_WORKER_ENV_KEYS = [
  "BACKGROUND_JOBS_MODE",
  "VERCEL",
  "DOCUMENT_WORKER_URL",
  "DOCUMENT_WORKER_JOB_TYPES",
  "DOCUMENT_WORKER_TOKEN",
  "DOCUMENT_WORKER_WAKE_TIMEOUT_MS",
  "DOCUMENT_WORKER_WAKE_ATTEMPTS",
  "DOCUMENT_WORKER_WAKE_RETRY_DELAY_MS",
] as const;

const savedEnv: Record<string, string | undefined> = {};

// A document-worker-routable job used as the sample for the routing rules
// below. Was CERTIFICATE_XLSX_PREVIEW until the XLSX certificate path was
// removed (#865); the routing under test is job-type agnostic.
const documentWorkerMessage: BackgroundJobMessage = {
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

describe("enqueueBackgroundJob — document-worker routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of DOCUMENT_WORKER_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    // Force the production dispatch path (skip local/inline in-process modes).
    process.env.BACKGROUND_JOBS_MODE = "vercel";
    // Single wake attempt with no backoff by default, so the fire-and-forget
    // wake in enqueueBackgroundJob can't leak a retry into the next test. The
    // retry-specific tests opt back into multiple attempts and await the wake.
    process.env.DOCUMENT_WORKER_WAKE_ATTEMPTS = "1";
    process.env.DOCUMENT_WORKER_WAKE_RETRY_DELAY_MS = "0";
    mocks.send.mockResolvedValue({ messageId: "vercel-message-1" });
    mocks.enqueueQueueJob.mockResolvedValue(42);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null)));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const key of DOCUMENT_WORKER_ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses Vercel Queue when DOCUMENT_WORKER_URL is not set", async () => {
    process.env.DOCUMENT_WORKER_JOB_TYPES = "AUDIT_PACK";

    const result = await enqueueBackgroundJob(documentWorkerMessage);

    expect(mocks.enqueueQueueJob).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(result.messageId).toBe("vercel-message-1");
  });

  it("uses Vercel Queue when the allowlist is empty", async () => {
    process.env.DOCUMENT_WORKER_URL = "https://dw.example.com";

    const result = await enqueueBackgroundJob(documentWorkerMessage);

    expect(mocks.enqueueQueueJob).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(result.messageId).toBe("vercel-message-1");
  });

  it("routes an allowlisted job to app_queue_job and wakes the container", async () => {
    process.env.DOCUMENT_WORKER_URL = "https://dw.example.com";
    process.env.DOCUMENT_WORKER_JOB_TYPES = "AUDIT_PACK";
    process.env.DOCUMENT_WORKER_TOKEN = "secret-token";

    const result = await enqueueBackgroundJob(documentWorkerMessage);

    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.enqueueQueueJob).toHaveBeenCalledWith(documentWorkerMessage);
    expect(result.messageId).toBe("app-queue-42");

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url.toString()).toBe("https://dw.example.com/drain");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("X-Worker-Token")).toBe(
      "secret-token",
    );
  });

  it("normalizes an omitted CERTIFICATE type when matching the allowlist", async () => {
    process.env.DOCUMENT_WORKER_URL = "https://dw.example.com";
    process.env.DOCUMENT_WORKER_JOB_TYPES = "CERTIFICATE";

    const result = await enqueueBackgroundJob(certificateMessage);

    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.enqueueQueueJob).toHaveBeenCalledWith(certificateMessage);
    expect(result.messageId).toBe("app-queue-42");
  });

  it("keeps job types outside the allowlist on Vercel Queue", async () => {
    process.env.DOCUMENT_WORKER_URL = "https://dw.example.com";
    process.env.DOCUMENT_WORKER_JOB_TYPES = "CERTIFICATE";

    const result = await enqueueBackgroundJob(serviceOrderQuoteMessage);

    expect(mocks.enqueueQueueJob).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(result.messageId).toBe("vercel-message-1");
  });

  it("never routes SCHEDULED_NOTIFICATIONS to the container", async () => {
    process.env.DOCUMENT_WORKER_URL = "https://dw.example.com";
    process.env.DOCUMENT_WORKER_JOB_TYPES =
      "SCHEDULED_NOTIFICATIONS,CERTIFICATE";

    const result = await enqueueBackgroundJob({
      type: "SCHEDULED_NOTIFICATIONS",
    });

    expect(mocks.enqueueQueueJob).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(result.messageId).toBe("vercel-message-1");
  });

  it("still returns success when the wake ping fails (job is durable)", async () => {
    process.env.DOCUMENT_WORKER_URL = "https://dw.example.com";
    process.env.DOCUMENT_WORKER_JOB_TYPES = "AUDIT_PACK";
    vi.mocked(fetch).mockRejectedValue(new Error("worker unreachable"));

    const result = await enqueueBackgroundJob(documentWorkerMessage);

    expect(mocks.enqueueQueueJob).toHaveBeenCalledWith(documentWorkerMessage);
    expect(result.messageId).toBe("app-queue-42");
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("retries the drain wake when the first attempt fails (cold start)", async () => {
    process.env.DOCUMENT_WORKER_TOKEN = "secret-token";
    process.env.DOCUMENT_WORKER_WAKE_ATTEMPTS = "3";
    process.env.DOCUMENT_WORKER_WAKE_RETRY_DELAY_MS = "0";
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockRejectedValueOnce(new Error("cold start in progress"))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));

    await expect(
      wakeDocumentWorker("https://dw.example.com"),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      new Headers(fetchMock.mock.calls[0][1]?.headers).get("X-Worker-Token"),
    ).toBe("secret-token");
  });

  it("retries when the drain ping returns a non-2xx response", async () => {
    process.env.DOCUMENT_WORKER_WAKE_ATTEMPTS = "2";
    process.env.DOCUMENT_WORKER_WAKE_RETRY_DELAY_MS = "0";
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));

    await expect(
      wakeDocumentWorker("https://dw.example.com"),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting the configured wake attempts", async () => {
    process.env.DOCUMENT_WORKER_WAKE_ATTEMPTS = "2";
    process.env.DOCUMENT_WORKER_WAKE_RETRY_DELAY_MS = "0";
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValue(new Error("worker unreachable"));

    await expect(wakeDocumentWorker("https://dw.example.com")).rejects.toThrow(
      "worker unreachable",
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops after the first successful attempt", async () => {
    process.env.DOCUMENT_WORKER_WAKE_ATTEMPTS = "3";
    process.env.DOCUMENT_WORKER_WAKE_RETRY_DELAY_MS = "0";
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));

    await wakeDocumentWorker("https://dw.example.com");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
