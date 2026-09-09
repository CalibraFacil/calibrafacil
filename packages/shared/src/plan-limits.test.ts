import { describe, expect, it } from "vitest";
import {
  getEffectivePlanLimits,
  PLANS,
  PROFESSIONAL_CERTIFICATE_LIMIT_CHANGE_AT,
  STANDARD_CERTIFICATE_LIMIT_CHANGE_AT,
} from "./plans";

const BEFORE_PROFESSIONAL_CHANGE = new Date(
  PROFESSIONAL_CERTIFICATE_LIMIT_CHANGE_AT.getTime() - 86_400_000,
);
const AFTER_PROFESSIONAL_CHANGE = new Date(
  PROFESSIONAL_CERTIFICATE_LIMIT_CHANGE_AT.getTime() + 86_400_000,
);

describe("getEffectivePlanLimits", () => {
  it("keeps the ceiling a Profissional customer contracted against", () => {
    // Retuning a published ladder decides what we offer next. It is not a
    // reason to start refusing work an existing customer already paid for,
    // which would arrive as a 402 mid-month with nothing on their side changed.
    expect(
      getEffectivePlanLimits("PROFESSIONAL", BEFORE_PROFESSIONAL_CHANGE)
        .certificates,
    ).toBe(800);
  });

  it("gives an organization created after the change the published ceiling", () => {
    expect(
      getEffectivePlanLimits("PROFESSIONAL", AFTER_PROFESSIONAL_CHANGE)
        .certificates,
    ).toBe(PLANS.PROFESSIONAL.limits.certificates);
  });

  it("still grandfathers the older Essencial ceiling", () => {
    const before = new Date(
      STANDARD_CERTIFICATE_LIMIT_CHANGE_AT.getTime() - 86_400_000,
    );

    expect(getEffectivePlanLimits("STANDARD", before).certificates).toBe(200);
  });

  it("uses the published ceiling when the creation date is unknown", () => {
    expect(getEffectivePlanLimits("PROFESSIONAL").certificates).toBe(
      PLANS.PROFESSIONAL.limits.certificates,
    );
  });
});
