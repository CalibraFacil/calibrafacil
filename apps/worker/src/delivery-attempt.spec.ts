import { describe, expect, it } from "vitest";
import { isFinalDelivery } from "./index";

describe("isFinalDelivery", () => {
  it("REQ-WRETRY-006 a runtime that supplies no attempt never redelivers, so its failure is final", () => {
    expect(isFinalDelivery(undefined)).toBe(true);
  });

  it("REQ-WRETRY-006 earlier deliveries are not final; the last (and any beyond it) is", () => {
    expect(isFinalDelivery({ attempt: 1, maxAttempts: 3 })).toBe(false);
    expect(isFinalDelivery({ attempt: 2, maxAttempts: 3 })).toBe(false);
    expect(isFinalDelivery({ attempt: 3, maxAttempts: 3 })).toBe(true);
    expect(isFinalDelivery({ attempt: 4, maxAttempts: 3 })).toBe(true);
  });
});
