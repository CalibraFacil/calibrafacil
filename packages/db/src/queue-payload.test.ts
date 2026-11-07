import { describe, expect, it } from "vitest";

import { isQueueMessage } from "./queue.js";

// The enqueue refusal and the dead-lettering of a claimed row run against
// Postgres: apps/worker/src/queue-retry.int.spec.ts (REQ-Q-2) and
// queue-payload-validation.int.spec.ts (REQ-Q-3).
describe("typed queue payloads (db layer)", () => {
  it("REQ-Q-3 isQueueMessage is the schema, not a shape sniff", () => {
    expect(isQueueMessage({ jobId: 1, userId: "u" })).toBe(true);
    expect(isQueueMessage({ type: "LABEL", jobId: "1", userId: "u" })).toBe(
      false,
    );
    expect(isQueueMessage({ type: "PORTAL_DIGEST" })).toBe(false);
  });
});
