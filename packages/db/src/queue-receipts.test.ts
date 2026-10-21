import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", () => ({
  db: { execute: vi.fn() },
}));

import { readQueueReceiptsMode } from "./queue-receipts.js";

describe("readQueueReceiptsMode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("REQ-QFENCE-006 defaults to enforce when QUEUE_RECEIPTS_MODE is unset", () => {
    vi.stubEnv("QUEUE_RECEIPTS_MODE", undefined);
    expect(readQueueReceiptsMode()).toBe("enforce");
  });

  it("REQ-QFENCE-006 defaults to enforce when blank or unrecognised", () => {
    vi.stubEnv("QUEUE_RECEIPTS_MODE", "");
    expect(readQueueReceiptsMode()).toBe("enforce");
    vi.stubEnv("QUEUE_RECEIPTS_MODE", "   ");
    expect(readQueueReceiptsMode()).toBe("enforce");
    vi.stubEnv("QUEUE_RECEIPTS_MODE", "strict");
    expect(readQueueReceiptsMode()).toBe("enforce");
  });

  it("REQ-QFENCE-007 keeps shadow and off as explicit opt-outs (case/space-insensitive)", () => {
    vi.stubEnv("QUEUE_RECEIPTS_MODE", "shadow");
    expect(readQueueReceiptsMode()).toBe("shadow");
    vi.stubEnv("QUEUE_RECEIPTS_MODE", " OFF ");
    expect(readQueueReceiptsMode()).toBe("off");
    vi.stubEnv("QUEUE_RECEIPTS_MODE", "Enforce");
    expect(readQueueReceiptsMode()).toBe("enforce");
  });
});
