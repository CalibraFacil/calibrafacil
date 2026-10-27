import { describe, expect, it } from "vitest";
import { decidePoint, isDecisionRuleKind } from "./decision-rule";

// Golden cases (roadmap 2 C4): tolerance T = 1.0, U = 0.2.
// margin m = T - |E|: E = 0.5 -> 0.5; E = 0.9 -> 0.1; E = 1.1 -> -0.1; E = 1.5 -> -0.5.
describe("decision rules (ILAC-G8)", () => {
  it("simple acceptance judges the measured value alone", () => {
    expect(decidePoint("simple_acceptance", 0.5, 0.2)).toBe("pass");
    expect(decidePoint("simple_acceptance", 0.1, 0.2)).toBe("pass");
    expect(decidePoint("simple_acceptance", 0, null)).toBe("pass");
    expect(decidePoint("simple_acceptance", -0.1, 0.2)).toBe("fail");
  });

  it("guarded acceptance (w = U) passes only a value inside the tolerance by at least U", () => {
    expect(decidePoint("guarded_acceptance", 0.5, 0.2)).toBe("pass");
    expect(decidePoint("guarded_acceptance", 0.2, 0.2)).toBe("pass");
    expect(decidePoint("guarded_acceptance", 0.1, 0.2)).toBe("fail");
    expect(decidePoint("guarded_acceptance", -0.5, 0.2)).toBe("fail");
    expect(decidePoint("guarded_acceptance", 0.5, null)).toBe("undetermined");
  });

  it("the non-binary rule has four zones and a negative U is its magnitude", () => {
    expect(decidePoint("non_binary", 0.5, 0.2)).toBe("pass");
    expect(decidePoint("non_binary", 0.1, 0.2)).toBe("conditional_pass");
    expect(decidePoint("non_binary", -0.1, 0.2)).toBe("conditional_fail");
    expect(decidePoint("non_binary", -0.5, -0.2)).toBe("fail");
    expect(decidePoint("non_binary", 0.1, Number.NaN)).toBe("undetermined");
  });

  it("recognises the declared kinds only", () => {
    expect(isDecisionRuleKind("non_binary")).toBe(true);
    expect(isDecisionRuleKind("shared_risk")).toBe(false);
    expect(isDecisionRuleKind(undefined)).toBe(false);
  });
});
