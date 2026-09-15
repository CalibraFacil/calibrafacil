import { describe, expect, it } from "vitest";

import {
  evaluateBudget,
  parseDecimal,
  parseObservations,
  type ContributionInput,
} from "./budget";

function typeB(
  overrides: Partial<ContributionInput> & Pick<ContributionInput, "id">,
): ContributionInput {
  return {
    label: "Contribuição",
    kind: "typeB",
    observations: "",
    distribution: "rectangular",
    halfWidth: "",
    expandedUncertainty: "",
    coverageFactor: "",
    sensitivity: "",
    degreesOfFreedom: "",
    ...overrides,
  };
}

describe("parseDecimal", () => {
  it("reads a pt-BR decimal comma", () => {
    expect(parseDecimal("0,05")).toBe(0.05);
  });

  it("treats a dot as the decimal separator when there is no comma", () => {
    expect(parseDecimal("1.5")).toBe(1.5);
  });

  it("treats dots as thousands separators when a comma is present", () => {
    expect(parseDecimal("1.234,56")).toBe(1234.56);
  });

  it("accepts scientific notation", () => {
    expect(parseDecimal("2,5e-3")).toBe(0.0025);
  });

  it("rejects text that is not a number", () => {
    expect(parseDecimal("0,05 g")).toBeNull();
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("--3")).toBeNull();
  });
});

describe("parseObservations", () => {
  // The regression that matters for pt-BR: splitting on commas would read ten
  // readings of "100,02" as twenty integers and report a spurious spread.
  it("never splits on a decimal comma", () => {
    expect(parseObservations("100,02 100,01 100,03").values).toEqual([
      100.02, 100.01, 100.03,
    ]);
  });

  it("splits on newlines, spaces and semicolons", () => {
    expect(parseObservations("1\n2; 3\t4").values).toEqual([1, 2, 3, 4]);
  });

  it("reports tokens it could not read", () => {
    expect(parseObservations("1 abc 3").invalid).toEqual(["abc"]);
  });
});

describe("evaluateBudget", () => {
  it("composes two Type B contributions and expands at k for infinite dof", () => {
    // u1 = 0.5/√3 = 0.2886751, u2 = 0.02/2 = 0.01
    // u_c = √(0.0833333 + 0.0001) = 0.28884829
    // Both ν = ∞ → ν_eff = ∞ → k = z(0,977250) = 2,0000024 for 95,45 %.
    // The exact normal quantile, not the rounded "k = 2" of the convention:
    // k = 2 is 95,4500 % coverage, which is what the shorthand approximates.
    const evaluation = evaluateBudget(
      [
        typeB({ id: "a", distribution: "rectangular", halfWidth: "0,5" }),
        typeB({
          id: "b",
          distribution: "normal",
          expandedUncertainty: "0,02",
          coverageFactor: "2",
        }),
      ],
      0.9545,
    );

    expect(evaluation.ok).toBe(true);
    if (!evaluation.ok) return;
    const { result } = evaluation;

    expect(result.contributions[0]?.standardUncertainty).toBeCloseTo(
      0.2886751,
      7,
    );
    expect(result.contributions[1]?.standardUncertainty).toBeCloseTo(0.01, 12);
    expect(result.combinedStandardUncertainty).toBeCloseTo(0.28884829, 8);
    expect(result.effectiveDegreesOfFreedom).toBe(Number.POSITIVE_INFINITY);
    expect(result.coverageFactor).toBeCloseTo(2.0000024, 7);
    expect(result.expandedUncertainty).toBeCloseTo(0.57769728, 7);
    expect(result.dominant?.id).toBe("a");
  });

  it("derives Type A statistics from repeated observations", () => {
    // n = 5, mean = 100.02, s = √(0.0002/4) = 0.00707107, u = s/√5 = 0.00316228
    const evaluation = evaluateBudget(
      [
        typeB({
          id: "a",
          kind: "typeA",
          observations: "100,02 100,01 100,03 100,02 100,02",
        }),
      ],
      0.9545,
    );

    expect(evaluation.ok).toBe(true);
    if (!evaluation.ok) return;
    const row = evaluation.result.contributions[0];

    expect(row?.typeA?.count).toBe(5);
    expect(row?.typeA?.mean).toBeCloseTo(100.02, 10);
    expect(row?.typeA?.sampleStandardDeviation).toBeCloseTo(0.00707107, 8);
    expect(row?.standardUncertainty).toBeCloseTo(0.00316228, 8);
    expect(row?.degreesOfFreedom).toBe(4);
  });

  it("applies Welch-Satterthwaite when a contribution has finite dof", () => {
    // Type A: u = 0.00316228, ν = 4 → var = 1e-5
    // Rect a = 0.01: u = 0.00577350, ν = ∞ → var = 3.33333e-5
    // u_c² = 4.33333e-5; ν_eff = u_c⁴ / (u_A⁴/4) = 75.111
    const evaluation = evaluateBudget(
      [
        typeB({
          id: "a",
          kind: "typeA",
          observations: "100,02 100,01 100,03 100,02 100,02",
        }),
        typeB({ id: "b", distribution: "rectangular", halfWidth: "0,01" }),
      ],
      0.9545,
    );

    expect(evaluation.ok).toBe(true);
    if (!evaluation.ok) return;
    const { result } = evaluation;

    expect(result.combinedStandardUncertainty).toBeCloseTo(0.00658281, 8);
    expect(result.effectiveDegreesOfFreedom).toBeCloseTo(75.111, 2);
    // Finite dof must widen k beyond the normal 2.0000.
    expect(result.coverageFactor).toBeGreaterThan(2.0);
    expect(result.coverageFactor).toBeLessThan(2.1);
    expect(result.dominant?.id).toBe("b");
  });

  it("scales a contribution by its sensitivity coefficient", () => {
    const evaluation = evaluateBudget(
      [
        typeB({
          id: "a",
          distribution: "rectangular",
          halfWidth: "0,5",
          sensitivity: "2",
        }),
      ],
      0.9545,
    );

    expect(evaluation.ok).toBe(true);
    if (!evaluation.ok) return;
    // |c| · u = 2 × 0.2886751
    expect(evaluation.result.combinedStandardUncertainty).toBeCloseTo(
      0.5773503,
      7,
    );
  });

  it("reports the variance share of each contribution", () => {
    const evaluation = evaluateBudget(
      [
        typeB({ id: "a", distribution: "rectangular", halfWidth: "0,5" }),
        typeB({ id: "b", distribution: "rectangular", halfWidth: "0,5" }),
      ],
      0.9545,
    );

    expect(evaluation.ok).toBe(true);
    if (!evaluation.ok) return;
    expect(evaluation.result.contributions[0]?.indexPercent).toBeCloseTo(50, 8);
    expect(evaluation.result.contributions[1]?.indexPercent).toBeCloseTo(50, 8);
  });

  it("rejects a Type A row with fewer than two observations", () => {
    const evaluation = evaluateBudget(
      [typeB({ id: "a", kind: "typeA", observations: "100,02" })],
      0.9545,
    );

    expect(evaluation.ok).toBe(false);
    if (evaluation.ok) return;
    expect(evaluation.issues[0]?.field).toBe("observations");
  });

  it("rejects a normal Type B row missing its coverage factor", () => {
    const evaluation = evaluateBudget(
      [typeB({ id: "a", distribution: "normal", expandedUncertainty: "0,02" })],
      0.9545,
    );

    expect(evaluation.ok).toBe(false);
    if (evaluation.ok) return;
    expect(evaluation.issues[0]?.field).toBe("coverageFactor");
  });

  it("refuses a budget whose contributions are all zero", () => {
    const evaluation = evaluateBudget(
      [typeB({ id: "a", distribution: "rectangular", halfWidth: "0" })],
      0.9545,
    );

    expect(evaluation.ok).toBe(false);
    if (evaluation.ok) return;
    expect(evaluation.issues[0]?.contributionId).toBeNull();
  });
});
