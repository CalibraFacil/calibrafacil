import { describe, expect, it } from "vitest";

import { queueJobMaxAttempts, queueJobRetryDelayMs } from "./background-jobs";

describe("queue job retry policy", () => {
  it("doubles from five seconds for our own jobs, capped at five minutes", () => {
    expect(
      [1, 2, 3, 4].map((n) => queueJobRetryDelayMs("CERTIFICATE", n)),
    ).toEqual([5_000, 10_000, 20_000, 40_000]);
    expect(queueJobRetryDelayMs("LABEL", 20)).toBe(300_000);
    expect(queueJobMaxAttempts("SPC_RECOMPUTE")).toBe(3);
  });

  it("gives a webhook subscriber minutes to recover, capped at an hour", () => {
    expect(
      [1, 2, 3, 4].map((n) => queueJobRetryDelayMs("WEBHOOK_DELIVERY", n)),
    ).toEqual([30_000, 120_000, 480_000, 1_920_000]);
    expect(queueJobRetryDelayMs("WEBHOOK_DELIVERY", 9)).toBe(3_600_000);
    expect(queueJobMaxAttempts("WEBHOOK_DELIVERY")).toBe(5);
  });
});
