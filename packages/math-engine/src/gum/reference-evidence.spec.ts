import { describe, expect, it } from "vitest";
import { createCalculationEngine } from "../engine/create.js";
import { coverageFactorForProbability, typeBStandardUncertainty } from "../index.js";
import { typeAFromRepeatedObservations } from "../uncertainty/type-a.js";

// Reproduces the numerical evidence tables of the validation dossier
// (validation/math-engine/v<ENGINE_VERSION>/dossier.tex, "Resultados"). Each
// expectation carries the tolerance the dossier declares; a change here is a
// change to a controlled document and needs the dossier revised alongside.

describe("dossier evidence — additive reference case (GUM-style, recreated)", () => {
  // y = a + b1 + b2. `a` is Type A from five observations; b1 is rectangular
  // with half-width 0.0375·√3 (so u = 0.0375) and 24 assigned degrees of
  // freedom; b2 is triangular with half-width 0.0167·√6 (so u = 0.0167) and
  // infinite degrees of freedom. Reference values are closed-form.
  const observations = [0.1835, 0.1835, 0.197, 0.2105, 0.2105];
  const halfWidthB1 = 0.0375 * Math.sqrt(3);
  const halfWidthB2 = 0.0167 * Math.sqrt(6);

  it("Type A statistics of the five observations", () => {
    const typeA = typeAFromRepeatedObservations(observations);
    expect(typeA.mean).toBeCloseTo(0.197, 12);
    expect(typeA.sampleStandardDeviation).toBeCloseTo(0.0135, 12);
    expect(Math.abs(typeA.standardUncertainty - 0.00604)).toBeLessThanOrEqual(5e-6);
    expect(typeA.degreesOfFreedom).toBe(4);
  });

  it("Type B standard uncertainties from the half-widths", () => {
    const b1 = typeBStandardUncertainty({ distribution: "rectangular", halfWidth: halfWidthB1 });
    const b2 = typeBStandardUncertainty({ distribution: "triangular", halfWidth: halfWidthB2 });
    expect(Number(b1.standardUncertainty)).toBeCloseTo(0.0375, 12);
    expect(Number(b2.standardUncertainty)).toBeCloseTo(0.0167, 12);
  });

  it("combined model: value, u_c, ν_eff, k(95.45 %) and U", () => {
    const result = createCalculationEngine().evaluateMeasurementModel({
      formula: "a + b1 + b2",
      quantities: {
        a: { repeatedObservations: observations },
        b1: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: halfWidthB1 }, degreesOfFreedom: 24 },
        b2: { estimate: 0, typeB: { distribution: "triangular", halfWidth: halfWidthB2 }, degreesOfFreedom: Number.POSITIVE_INFINITY }
      },
      coverageProbability: 0.9545
    });

    expect(Number(result.value)).toBeCloseTo(0.197, 12);
    // u_c = √(0.0135²/5 + 0.0375² + 0.0167²) = 0.041492…
    expect(Math.abs(Number(result.combinedStandardUncertainty) - 0.0415)).toBeLessThanOrEqual(5e-4);
    // ν_eff = u_c⁴ / (u_A⁴/4 + u_B1⁴/24) = 35.83… — carried as a real number,
    // not truncated; the dossier reports the integer part for comparison.
    const effectiveDof = Number(result.effectiveDegreesOfFreedom);
    expect(Math.floor(effectiveDof)).toBe(35);
    expect(Math.abs(Number(result.coverageFactor) - 2.07)).toBeLessThanOrEqual(1e-2);
    expect(Math.abs(Number(result.expandedUncertainty) - 0.086)).toBeLessThanOrEqual(3e-3);
  });
});

describe("dossier evidence — Student-t coverage factors vs published tables", () => {
  // Columns: ν, k(p = 0.95), k(p = 0.9545), k(p = 0.99). Sources: NIST/SEMATECH
  // e-Handbook §1.3.6.7.2 (two-sided 95 % and 99 %) and JCGM 100:2008 Table G.2
  // (p = 95.45 %), both rounded to three decimals as published.
  const table: ReadonlyArray<readonly [number, number, number, number]> = [
    [1, 12.706, 13.968, 63.657],
    [2, 4.303, 4.527, 9.925],
    [3, 3.182, 3.307, 5.841],
    [4, 2.776, 2.869, 4.604],
    [5, 2.571, 2.649, 4.032],
    [10, 2.228, 2.284, 3.169],
    [16, 2.12, 2.169, 2.921],
    [20, 2.086, 2.133, 2.845],
    [30, 2.042, 2.087, 2.75],
    [35, 2.03, 2.074, 2.724],
    [50, 2.009, 2.051, 2.678],
    [100, 1.984, 2.025, 2.626],
    [200, 1.972, 2.013, 2.601],
    [500, 1.965, 2.005, 2.586]
  ];

  it.each(table)("ν = %d: k(0.95) ≈ %f, k(0.9545) ≈ %f, k(0.99) ≈ %f", (dof, k95, k9545, k99) => {
    expect(Math.abs(coverageFactorForProbability(0.95, dof) - k95)).toBeLessThanOrEqual(3e-3);
    expect(Math.abs(coverageFactorForProbability(0.9545, dof) - k9545)).toBeLessThanOrEqual(4e-3);
    expect(Math.abs(coverageFactorForProbability(0.99, dof) - k99)).toBeLessThanOrEqual(4e-3);
  });

  it("ν = ∞ falls back to the normal quantile (1.960 / 2.000 / 2.576)", () => {
    expect(Math.abs(coverageFactorForProbability(0.95, Number.POSITIVE_INFINITY) - 1.96)).toBeLessThanOrEqual(3e-3);
    expect(Math.abs(coverageFactorForProbability(0.9545, Number.POSITIVE_INFINITY) - 2.0)).toBeLessThanOrEqual(4e-3);
    expect(Math.abs(coverageFactorForProbability(0.99, Number.POSITIVE_INFINITY) - 2.576)).toBeLessThanOrEqual(4e-3);
  });
});
