import { describe, expect, it } from "vitest";
import { getRetryDelayMs } from "./queue";

describe("getRetryDelayMs", () => {
  it("doubles from five seconds for our own jobs, capped at five minutes", () => {
    expect([1, 2, 3, 4].map((n) => getRetryDelayMs(n, "CERTIFICATE"))).toEqual([
      5_000, 10_000, 20_000, 40_000,
    ]);
    expect(getRetryDelayMs(20, "LABEL")).toBe(300_000);
  });

  it("gives a webhook subscriber minutes to recover, capped at an hour", () => {
    expect(
      [1, 2, 3, 4].map((n) => getRetryDelayMs(n, "WEBHOOK_DELIVERY")),
    ).toEqual([30_000, 120_000, 480_000, 1_920_000]);
    expect(getRetryDelayMs(9, "WEBHOOK_DELIVERY")).toBe(3_600_000);
  });
});
