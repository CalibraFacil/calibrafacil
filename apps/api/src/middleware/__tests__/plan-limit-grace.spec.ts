import { describe, expect, it } from "vitest";
import { PLANS } from "@calibra-facil/shared";

import { decidePlanLimit, graceCeiling } from "../plan-limit-grace";

describe("plan limit grace band", () => {
  const professional = {
    planId: "PROFESSIONAL" as const,
    resource: "certificates" as const,
  };
  // Read from the plan rather than written down here: the ladder is retuned
  // as the market is understood, and a hard-coded ceiling turns that into a
  // failing test instead of a passing one.
  const limit = PLANS.PROFESSIONAL.limits.certificates;
  const ceiling = limit + Math.ceil(limit * 0.1);

  it("passes anything inside the plan ceiling", () => {
    expect(
      decidePlanLimit({ ...professional, usage: limit - 1, requestedCount: 1 }),
    ).toEqual({ outcome: "within" });
  });

  // Blocking a lab on the 28th is the day their customer has no certificate.
  it("opens a grace band just past the ceiling instead of stopping the work", () => {
    const decision = decidePlanLimit({
      ...professional,
      usage: limit,
      requestedCount: 1,
    });

    expect(decision.outcome).toBe("grace");
    if (decision.outcome === "grace") {
      expect(decision.limit).toBe(limit);
      expect(decision.ceiling).toBe(ceiling);
    }
  });

  it("still stops once the band is spent", () => {
    const decision = decidePlanLimit({
      ...professional,
      usage: ceiling,
      requestedCount: 1,
    });

    expect(decision.outcome).toBe("blocked");
  });

  it("gives a small plan at least five, not ten per cent of very little", () => {
    expect(graceCeiling("certificates", 10)).toBe(15);
    expect(graceCeiling("certificates", 100)).toBe(110);
  });

  // An extra seat is a deliberate decision, not a surprise mid-calibration.
  it("does not extend the seat limit", () => {
    expect(graceCeiling("users", 5)).toBe(5);
    expect(
      decidePlanLimit({
        planId: "STANDARD",
        resource: "users",
        usage: 999,
        requestedCount: 1,
      }).outcome,
    ).toBe("blocked");
  });
});
