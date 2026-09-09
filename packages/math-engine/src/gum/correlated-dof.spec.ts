import { describe, expect, it } from "vitest";
import { createCalculationEngine } from "../engine/create.js";
import { ERROR_CODES } from "../errors/codes.js";
import {
  generalizedWelchSatterthwaiteDegreesOfFreedom,
  welchSatterthwaiteDegreesOfFreedom
} from "./statistics.js";

// Effective degrees of freedom for correlated input quantities (0.4.0).
// Reference: Castrup, "A Welch-Satterthwaite Relation for Correlated Errors"
// (Proc. Meas. Sci. Conf. 2010, rev. 2020), Eq. 46; cf. Willink, Metrologia 44
// (2007) 340. Hand values below follow the closed form in the function doc.

describe("generalizedWelchSatterthwaiteDegreesOfFreedom", () => {
  it("reduces to GUM Eq. G.2b when every correlation is zero", () => {
    const b = [0.3, -0.7, 1.1, 0.05];
    const dofs = [4, 9, Infinity, 24];
    const identity = b.map((_row, i) => b.map((_column, j) => (i === j ? 1 : 0)));
    const variance = b.reduce((sum, value) => sum + value * value, 0);
    const standard = welchSatterthwaiteDegreesOfFreedom(
      variance,
      b.map((value) => value * value),
      dofs
    );
    expect(generalizedWelchSatterthwaiteDegreesOfFreedom(variance, b, identity, dofs)).toBeCloseTo(standard, 10);
  });

  it.each([
    // [ρ, expected] for b1 = b2 = 1, ν1 = ν2 = 10:
    //   u_c² = 2 + 2ρ, D = 0.2 + ρ²·0.205 + 2ρ·0.2
    [0.5, 9 / 0.45125],
    [1, 16 / 0.805],
    [-0.5, 1 / 0.05125]
  ])("two equal components with ρ = %f", (rho, expected) => {
    const variance = 2 + 2 * rho;
    const result = generalizedWelchSatterthwaiteDegreesOfFreedom(
      variance,
      [1, 1],
      [
        [1, rho],
        [rho, 1]
      ],
      [10, 10]
    );
    expect(result).toBeCloseTo(expected, 10);
  });

  it("drops every term of an input with infinite degrees of freedom", () => {
    // Only b1 carries finite ν: D = b1⁴/ν1 + ρ² b1² b2² /ν1 + 2ρ b1 b2 b1²/ν1.
    const b1 = 0.4;
    const b2 = 0.9;
    const rho = 0.3;
    const variance = b1 * b1 + b2 * b2 + 2 * rho * b1 * b2;
    const denominator = b1 ** 4 / 6 + (rho * rho * b1 * b1 * b2 * b2) / 6 + (2 * rho * b1 * b2 * b1 * b1) / 6;
    const result = generalizedWelchSatterthwaiteDegreesOfFreedom(
      variance,
      [b1, b2],
      [
        [1, rho],
        [rho, 1]
      ],
      [6, Infinity]
    );
    expect(result).toBeCloseTo((variance * variance) / denominator, 10);
  });

  it("is scale invariant", () => {
    const rho = [
      [1, 0.4],
      [0.4, 1]
    ];
    const small = generalizedWelchSatterthwaiteDegreesOfFreedom(1e-180 * (1 + 1 + 0.8), [1e-90, 1e-90], rho, [5, 7]);
    const unit = generalizedWelchSatterthwaiteDegreesOfFreedom(2.8, [1, 1], rho, [5, 7]);
    expect(small).toBeCloseTo(unit, 10);
  });

  it("returns infinite degrees of freedom when no component carries finite ν", () => {
    expect(
      generalizedWelchSatterthwaiteDegreesOfFreedom(
        3,
        [1, 1],
        [
          [1, 0.5],
          [0.5, 1]
        ],
        [Infinity, Infinity]
      )
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it("includes the shared-index terms when a component takes part in several relationships", () => {
    // Three equal components, ν = 10 each, every ρ = 0.5. Each u_i estimate
    // enters two relationships, so its cross-products must be counted:
    //   u_c² = 3 + 6·0.5 = 6, and with B_i = 1 + 0.5 + 0.5 = 2,
    //   D = Σ (b_i B_i)²/ν_i + Σ_{i<j} ρ² b_i² b_j² /(2 ν_i ν_j)
    //     = 3·4/10 + 3·0.25/200 = 1.20375  →  ν_eff = 36/1.20375 ≈ 29.907.
    // The pairwise-only sum gives 1.05375 and an overstated 34.16.
    const rho = 0.5;
    const matrix = [
      [1, rho, rho],
      [rho, 1, rho],
      [rho, rho, 1]
    ];
    const result = generalizedWelchSatterthwaiteDegreesOfFreedom(6, [1, 1, 1], matrix, [10, 10, 10]);
    expect(result).toBeCloseTo(36 / 1.20375, 10);
    expect(result).not.toBeCloseTo(36 / 1.05375, 6);
  });

  it("reduces to the pairwise form when no component shares two relationships", () => {
    // b–c correlated, a independent: no shared index, so the closed form and
    // the pairwise sum agree (guards the new term against double counting).
    const rho = 0.4;
    const matrix = [
      [1, 0, 0],
      [0, 1, rho],
      [0, rho, 1]
    ];
    const variance = 3 + 2 * rho;
    const pairwise = 3 / 10 + rho * rho * (1 / 10 + 1 / 10 + 1 / 200) + 2 * rho * (1 / 10 + 1 / 10);
    expect(generalizedWelchSatterthwaiteDegreesOfFreedom(variance, [1, 1, 1], matrix, [10, 10, 10])).toBeCloseTo(
      (variance * variance) / pairwise,
      10
    );
  });

  it("rejects a correlation matrix that is not positive semidefinite", () => {
    // Bounded, unit diagonal and symmetric, but with a negative eigenvalue:
    // an impossible model must not produce a plausible ν_eff.
    const matrix = [
      [1, -0.9, -0.9],
      [-0.9, 1, -0.9],
      [-0.9, -0.9, 1]
    ];
    expect(() =>
      generalizedWelchSatterthwaiteDegreesOfFreedom(0.4, [1, 1, -1], matrix, [10, 10, 10])
    ).toThrowError(expect.objectContaining({ code: ERROR_CODES.INVALID_STATISTIC_INPUT }));
  });

  it.each([
    ["off-diagonal outside [-1, 1]", [[1, 1.5], [1.5, 1]]],
    ["non-unit diagonal", [[0.9, 0], [0, 1]]],
    ["asymmetric", [[1, 0.2], [0.3, 1]]]
  ])("rejects a %s correlation matrix", (_name, matrix) => {
    expect(() => generalizedWelchSatterthwaiteDegreesOfFreedom(2, [1, 1], matrix, [10, 10])).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.INVALID_STATISTIC_INPUT })
    );
  });
});

describe("evaluateMeasurementModel — correlatedDegreesOfFreedom policy", () => {
  const model = {
    formula: "a + b",
    quantities: {
      a: { estimate: "1", standardUncertainty: "1", degreesOfFreedom: 10 },
      b: { estimate: "1", standardUncertainty: "1", degreesOfFreedom: 10 }
    },
    correlations: [["a", "b", 0.5]] as const
  };

  it("uses the generalized form by default and records it", () => {
    const result = createCalculationEngine().evaluateMeasurementModel(model);
    expect(Number(result.combinedStandardUncertainty)).toBeCloseTo(Math.sqrt(3), 12);
    expect(Number(result.effectiveDegreesOfFreedom)).toBeCloseTo(9 / 0.45125, 10);
    expect(result.diagnostics.map((d) => d.code)).toContain("EFFECTIVE_DEGREES_OF_FREEDOM_GENERALIZED");
    expect(result.diagnostics.map((d) => d.code)).not.toContain("WELCH_SATTERTHWAITE_CORRELATION_LIMITATION");
    expect(result.canonicalResultJson).toBeTypeOf("string");
  });

  it("keeps the diagonal form as an explicit opt-in, with the limitation warning", () => {
    const result = createCalculationEngine().evaluateMeasurementModel({
      ...model,
      correlatedDegreesOfFreedom: "diagonal"
    });
    // Diagonal G.2b: 9 / (1/10 + 1/10) = 45.
    expect(Number(result.effectiveDegreesOfFreedom)).toBeCloseTo(45, 10);
    expect(result.diagnostics.map((d) => d.code)).toContain("WELCH_SATTERTHWAITE_CORRELATION_LIMITATION");
  });

  it("fingerprints the two policies differently for a correlated model", () => {
    const engine = createCalculationEngine();
    const generalized = engine.evaluateMeasurementModel(model);
    const diagonal = engine.evaluateMeasurementModel({ ...model, correlatedDegreesOfFreedom: "diagonal" });
    expect(generalized.calculationFingerprint).not.toBe(diagonal.calculationFingerprint);
  });

  it("ignores the policy — and fingerprints identically — when no relationship is declared", () => {
    const engine = createCalculationEngine();
    const uncorrelated = { formula: "a + b", quantities: model.quantities };
    const plain = engine.evaluateMeasurementModel(uncorrelated);
    const explicit = engine.evaluateMeasurementModel({ ...uncorrelated, correlatedDegreesOfFreedom: "diagonal" });
    expect(Number(plain.effectiveDegreesOfFreedom)).toBeCloseTo(20, 10);
    expect(explicit.calculationFingerprint).toBe(plain.calculationFingerprint);
    expect(plain.diagnostics.map((d) => d.code)).not.toContain("EFFECTIVE_DEGREES_OF_FREEDOM_GENERALIZED");
  });

  it("treats empty relationship collections as an uncorrelated model", () => {
    // The shipped volume-glassware and humidity-magnus templates declare
    // `correlations: []`/`covariances: []`. No relationship exists, so the
    // model must take the ordinary path — no generalized diagnostic, and no
    // correlation policy in the fingerprinted canonical input.
    const engine = createCalculationEngine();
    const uncorrelated = { formula: "a + b", quantities: model.quantities };
    const plain = engine.evaluateMeasurementModel(uncorrelated);
    const empty = engine.evaluateMeasurementModel({
      ...uncorrelated,
      correlations: [],
      covariances: []
    });
    expect(Number(empty.effectiveDegreesOfFreedom)).toBe(Number(plain.effectiveDegreesOfFreedom));
    expect(empty.diagnostics.map((d) => d.code)).not.toContain("EFFECTIVE_DEGREES_OF_FREEDOM_GENERALIZED");
    // The policy is not recorded, so declaring one cannot change the result.
    expect(
      engine.evaluateMeasurementModel({
        ...uncorrelated,
        correlations: [],
        covariances: [],
        correlatedDegreesOfFreedom: "diagonal"
      }).calculationFingerprint
    ).toBe(empty.calculationFingerprint);
  });

  it("rejects an unknown policy", () => {
    // Round-tripped through JSON, as it arrives over the wire from a method
    // definition: shape validation is the subject under test.
    const wire = JSON.parse(JSON.stringify({ ...model, correlatedDegreesOfFreedom: "conservative" }));
    expect(() => createCalculationEngine().evaluateMeasurementModel(wire)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.INVALID_INPUT_SHAPE })
    );
  });
});
