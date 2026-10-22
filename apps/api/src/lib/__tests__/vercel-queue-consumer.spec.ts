import { beforeEach, describe, expect, it, vi } from "vitest";

// The Vercel Queue consumer must run the same parse step as the Postgres drain
// (REQ-Q-5): a handler only ever sees a message that matched its job schema, and
// one that cannot match is dead-lettered instead of redelivered.

const mocks = vi.hoisted(() => ({
  processBackgroundJob: vi.fn(),
  runIntegrationSync: vi.fn(),
  runWithQueueReceipt: vi.fn(
    async (_params: unknown, work: () => Promise<void>) => work(),
  ),
}));

vi.mock("../../../vercel-src/assert-config", () => ({}));

// handleCallback returns the route handler; expose the inner callback directly.
vi.mock("@vercel/queue", () => ({
  handleCallback: (
    callback: (body: unknown, metadata: unknown) => Promise<void>,
  ) => callback,
}));

vi.mock("@calibra-facil/worker", () => ({
  processBackgroundJob: mocks.processBackgroundJob,
}));

vi.mock("@calibra-facil/db/queue-receipts", () => ({
  QueueReceiptHeldError: class QueueReceiptHeldError extends Error {},
  runWithQueueReceipt: mocks.runWithQueueReceipt,
  vercelQueueReceiptKey: (messageId: string) => `vq:${messageId}`,
}));

vi.mock("../background-jobs", () => ({
  resolveQueueJobType: () => "CERTIFICATE",
}));

vi.mock("../../modules/integrations", () => ({
  runIntegrationSync: mocks.runIntegrationSync,
}));

vi.mock("../runtime-env", () => ({
  createWorkerRuntimeEnv: vi.fn(() => ({})),
}));

import { POST } from "../../../vercel-src/queues/background";

const METADATA = { messageId: "msg-1", deliveryCount: 1 };

// handleCallback is mocked to the callback itself; the real one returns a route
// handler. Narrow it back to the callback's shape without an assertion.
function deliver(body: unknown): Promise<void> {
  if (typeof POST !== "function") throw new Error("POST is not callable");
  return Promise.resolve(Reflect.apply(POST, undefined, [body, METADATA]));
}

describe("Vercel Queue consumer parses like the database drain (REQ-Q-5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.processBackgroundJob.mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("REQ-Q-5 a message failing its schema is dead-lettered with its reason: never run, never thrown into redelivery", async () => {
    await expect(
      deliver({ type: "LABEL", jobId: "7", userId: "u" }),
    ).resolves.toBeUndefined();

    expect(mocks.runWithQueueReceipt).not.toHaveBeenCalled();
    expect(mocks.processBackgroundJob).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("msg-1"),
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("jobId"),
    );
  });

  it("REQ-Q-5 an unknown job type is dead-lettered the same way", async () => {
    await expect(deliver({ type: "SHIP_PIZZA" })).resolves.toBeUndefined();

    expect(mocks.processBackgroundJob).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("SHIP_PIZZA"),
    );
  });

  it("REQ-Q-5 a valid message reaches the handler as the parsed, typed payload", async () => {
    await deliver({ type: "LABEL", jobId: 7, userId: "u", leaked: "x" });

    expect(mocks.processBackgroundJob).toHaveBeenCalledWith(
      expect.anything(),
      { type: "LABEL", jobId: 7, userId: "u" },
      expect.objectContaining({ attempt: 1 }),
    );
  });
});
