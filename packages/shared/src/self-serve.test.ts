import { describe, expect, it } from "vitest";

import { checkSelfServeEligibility } from "./self-serve";

describe("checkSelfServeEligibility", () => {
  it("lets a brand-new organization contract", () => {
    expect(checkSelfServeEligibility(null).ok).toBe(true);
  });

  it("lets a free organization contract", () => {
    expect(
      checkSelfServeEligibility({ planId: "FREE", status: "TRIAL" }).ok,
    ).toBe(true);
  });

  it.each(["ACTIVE", "PAST_DUE"] as const)(
    "refuses a paid plan that is still billing (%s)",
    (status) => {
      const result = checkSelfServeEligibility({
        planId: "PROFESSIONAL",
        status,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("PLAN_CHANGE_REQUIRES_SUPPORT");
      }
    },
  );

  it("lets a canceled paid plan contract again — nothing is billing", () => {
    expect(
      checkSelfServeEligibility({
        planId: "PROFESSIONAL",
        status: "CANCELED",
      }).ok,
    ).toBe(true);
  });
});
