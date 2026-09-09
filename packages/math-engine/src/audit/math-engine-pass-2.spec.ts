import { describe, expect, it } from "vitest";
import { createCalculationEngine } from "../engine/create.js";
import { ERROR_CODES } from "../errors/codes.js";
import {
  mean,
  sampleStandardDeviation,
  standardUncertaintyOfMean,
  welchSatterthwaiteDegreesOfFreedom,
} from "../gum/statistics.js";
import { DeterministicDecimal } from "../numeric/decimal.js";
import { typeAFromRepeatedObservations } from "../uncertainty/type-a.js";

describe("second-pass math-engine audit regressions", () => {
  it("evaluates symbolic sensitivities without losing decimal estimate precision", () => {
    const result = createCalculationEngine().evaluateMeasurementModel({
      formula: "(x-9007199254740992)^2",
      quantities: {
        x: { estimate: "9007199254740993", standardUncertainty: 0.01 },
      },
    });

    expect(Number(result.value)).toBe(1);
    expect(Number(result.sensitivityCoefficients.x)).toBe(2);
    expect(Number(result.combinedStandardUncertainty)).toBeCloseTo(0.02, 14);
  });

  it("keeps 0.3.0 double-precision sensitivities for estimates a double can carry", () => {
    // 100.123 - 100.1 is not exactly 0.023 in doubles; the byte-stable path is
    // the double one, so recorded fingerprints under this engine version hold.
    const result = createCalculationEngine().evaluateMeasurementModel({
      formula: "(I_x - I_ref) * k",
      quantities: {
        I_x: { estimate: "100.123", standardUncertainty: "0.0012" },
        I_ref: { estimate: "100.1", standardUncertainty: "0.0005" },
        k: { estimate: "1.0004", standardUncertainty: "0.0002" },
      },
    });

    expect(Number(result.sensitivityCoefficients.k)).toBe(100.123 - 100.1);
    expect(Number(result.sensitivityCoefficients.I_x)).toBe(1.0004);
  });

  it("rejects lossy decimal estimates before numerical differentiation", () => {
    expect(() =>
      createCalculationEngine().evaluateMeasurementModel({
        formula: "student_t_inverse_2t(0.05, x)",
        quantities: {
          x: { estimate: "9007199254740993", standardUncertainty: 0.01 },
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.UNSAFE_NUMERIC_RANGE }),
    );
  });

  it("computes Type A statistics before converting exact observations to doubles", () => {
    const result = typeAFromRepeatedObservations([
      "1.00000000000000001",
      "1.00000000000000002",
      "1.00000000000000003",
    ]);

    expect(result.mean).toBe(1);
    expect(result.sampleStandardDeviation).toBeCloseTo(1e-17, 30);
    expect(result.standardUncertainty).toBeCloseTo(1e-17 / Math.sqrt(3), 30);
  });

  it("returns zero uncertainty for identical observations beyond double precision", () => {
    const result = typeAFromRepeatedObservations(
      Array(10).fill("0.10000000000000000001"),
    );
    expect(result.sampleStandardDeviation).toBe(0);
    expect(result.standardUncertainty).toBe(0);
  });

  it("keeps the 0.3.0 double statistics for observations that round-trip through doubles", () => {
    const observations = [10.001, "10.002", "10.0030"];
    const doubles = [10.001, 10.002, 10.003];
    const result = typeAFromRepeatedObservations(observations);
    expect(result.observations).toEqual(doubles);
    expect(result.mean).toBe(mean(doubles));
    expect(result.sampleStandardDeviation).toBe(
      sampleStandardDeviation(doubles),
    );
    expect(result.standardUncertainty).toBe(standardUncertaintyOfMean(doubles));
  });

  it("distinguishes adjacent number-mode inputs and results in audit fingerprints", () => {
    const formula = createCalculationEngine({
      numericMode: "number",
    }).compileFormula("x");
    const exact = formula.evaluate({ x: 0.3 });
    const drifted = formula.evaluate({ x: 0.1 + 0.2 });

    expect(exact.valueText).toBe("0.3");
    expect(drifted.valueText).toBe("0.3");
    expect(exact.value).not.toBe(drifted.value);
    expect(exact.calculationFingerprint).not.toBe(
      drifted.calculationFingerprint,
    );
  });

  it("distinguishes adjacent number-mode measurement inputs in audit fingerprints", () => {
    const engine = createCalculationEngine({ numericMode: "number" });
    const evaluate = (estimate: number) =>
      engine.evaluateMeasurementModel({
        formula: "x",
        quantities: { x: { estimate, standardUncertainty: 1 } },
      });

    expect(evaluate(0.3).calculationFingerprint).not.toBe(
      evaluate(0.1 + 0.2).calculationFingerprint,
    );
  });

  it("keeps Welch-Satterthwaite degrees of freedom scale invariant", () => {
    for (const variance of [1, 1e-100, 1e-180, 1e100]) {
      expect(
        welchSatterthwaiteDegreesOfFreedom(variance, [variance], [2]),
      ).toBeCloseTo(2, 14);
    }
  });

  it("preserves finite degrees of freedom and coverage at tiny scales", () => {
    const result = createCalculationEngine().evaluateMeasurementModel({
      formula: "x",
      quantities: {
        x: {
          estimate: 1,
          standardUncertainty: `0.${"0".repeat(89)}1`,
          degreesOfFreedom: 2,
        },
      },
    });

    expect(Number(result.combinedStandardUncertainty)).toBe(1e-90);
    expect(Number(result.effectiveDegreesOfFreedom)).toBeCloseTo(2, 14);
    expect(Number(result.coverageFactor)).toBeCloseTo(4.30265273, 7);
  });

  it("serializes exact decimal results below the double range without zeroing", () => {
    const result = createCalculationEngine()
      .compileFormula("((1e-12)^12)^3")
      .evaluate({});

    expect(result.value).toBe("1e-432");
    expect(result.valueText).toBe("1e-432");
  });

  it.each([
    [1n, 3n, "0.3333333333333333"],
    [1n, 6n, "0.1666666666666667"],
    // Normal-range texts are unchanged from the double-mediated path so the
    // canonical value (and fingerprints) stay stable under the same engine
    // version: -2/3 keeps its 0.3.0 text (the double is -0.66666666666666663).
    [-2n, 3n, "-0.6666666666666666"],
    [299999999999999999n, 300000000000000000n, "1"],
    // Below the double range the rational itself is rounded.
    [1n, 3n * 10n ** 400n, "3.333333333333333e-401"],
    [-2n, 3n * 10n ** 400n, "-6.666666666666667e-401"],
    [1n, 10n ** 432n, "1e-432"],
  ])(
    "rounds the rational %s/%s deterministically",
    (numerator, denominator, expected) => {
      expect(
        DeterministicDecimal.of(numerator, denominator).toCanonicalString(),
      ).toBe(expected);
    },
  );

  it("keeps a subnormal-range nonzero quotient inside a larger expression consistent with its own text", () => {
    const engine = createCalculationEngine();
    const tiny = engine.compileFormula("((1e-12)^12)^3").evaluate({}).value;
    const ratio = engine
      .compileFormula("(((1e-12)^12)^3)/(((1e-12)^12)^3)")
      .evaluate({}).value;
    expect(tiny).toBe("1e-432");
    expect(ratio).toBe("1");
  });

  it.each([
    ["nested calls", "sin(".repeat(4_000) + "1" + ")".repeat(4_000)],
    ["unary operators", "-".repeat(20_000) + "1"],
    ["powers", "1^".repeat(10_000) + "1"],
  ])("bounds %s before the JavaScript call stack", (_name, expression) => {
    expect(() =>
      createCalculationEngine({
        maxExpressionLength: 100_000,
        maxAstDepth: 64,
      }).compileFormula(expression),
    ).toThrowError(expect.objectContaining({ code: ERROR_CODES.AST_TOO_DEEP }));
  });
});

describe("PR #902 review follow-ups", () => {
  const fourQuantities = {
    a: { estimate: 1, standardUncertainty: 0.1 },
    b: { estimate: 1, standardUncertainty: 0.1 },
    c: { estimate: 1, standardUncertainty: 0.1 },
    d: { estimate: 1, standardUncertainty: 0.1 },
  };

  it("factors small positive Cholesky pivots instead of collapsing them", () => {
    // det ≈ 7.49e-15 > 0: positive definite, c-pivot ≈ 1e-7 with a 5e-8 residual.
    const result = createCalculationEngine().evaluateMeasurementModel({
      formula: "a+b+c+d",
      quantities: fourQuantities,
      correlations: [
        ["b", "c", 1 - 5e-15],
        ["b", "d", 0],
        ["c", "d", 5e-8],
      ],
    });
    expect(Number(result.combinedStandardUncertainty)).toBeCloseTo(
      Math.sqrt(0.01 * (4 + 2 * (1 - 5e-15) + 2 * 5e-8)),
      15,
    );
  });

  it.each([
    ["exactly singular", 1],
    ["nearly singular", 1 - 5e-15],
  ])(
    "still rejects an inconsistent residual next to a %s pivot",
    (_name, correlation) => {
      expect(() =>
        createCalculationEngine().evaluateMeasurementModel({
          formula: "a+b+c+d",
          quantities: fourQuantities,
          correlations: [
            ["b", "c", correlation],
            ["b", "d", 0],
            ["c", "d", 0.5],
          ],
        }),
      ).toThrowError(
        expect.objectContaining({
          code: ERROR_CODES.INVALID_COVARIANCE_MATRIX,
        }),
      );
    },
  );

  it("evaluates domain arguments exactly in decimal mode before the double-safety check", () => {
    const engine = createCalculationEngine();
    const x = { estimate: "9007199254740993", standardUncertainty: 0.01 };

    const root = engine.evaluateMeasurementModel({
      formula: "sqrt(x-9007199254740992)",
      quantities: { x },
    });
    expect(root.value).toBe("1");
    expect(Number(root.sensitivityCoefficients.x)).toBe(0.5);

    // The double argument would be 0 and the log domain check would falsely fail.
    const log = engine.evaluateMeasurementModel({
      formula: "log(x-9007199254740992)",
      quantities: { x },
    });
    expect(log.value).toBe("0");
    expect(Number(log.sensitivityCoefficients.x)).toBe(1);
  });

  it("computes the Welch-Satterthwaite scale without an argument-count ceiling", () => {
    const count = 200_000;
    const contributions = Array.from({ length: count }, () => 1);
    const degreesOfFreedom = Array.from({ length: count }, () => 10);
    expect(
      welchSatterthwaiteDegreesOfFreedom(
        count,
        contributions,
        degreesOfFreedom,
      ),
    ).toBeCloseTo(10 * count, 3);
  });

  it("returns the canonical exact samples alongside the double observations", () => {
    const exact = typeAFromRepeatedObservations([
      "1.00000000000000001",
      "1.00000000000000002",
      "1.00000000000000003",
    ]);
    expect(exact.observations).toEqual([1, 1, 1]);
    expect(exact.canonicalObservations).toEqual([
      "1.00000000000000001",
      "1.00000000000000002",
      "1.00000000000000003",
    ]);

    const doubles = typeAFromRepeatedObservations([
      10.001,
      "10.002",
      "10.0030",
    ]);
    expect(doubles.canonicalObservations).toEqual([
      "10.001",
      "10.002",
      "10.003",
    ]);
  });

  it("keeps canonical observations exact beyond 120 fractional places", () => {
    // Within the 128-significant-digit input limit but past the cutoff at
    // which canonical texts round through a double.
    const samples = ["1", "2", "3"].map((last) => `1.${"0".repeat(120)}${last}`);
    const result = typeAFromRepeatedObservations(samples);
    expect(result.canonicalObservations).toEqual(samples);
    expect(result.observations).toEqual([1, 1, 1]);
    expect(result.sampleStandardDeviation).toBeCloseTo(1e-121, 135);
  });

  it("serializes a parsed decimal exactly regardless of its fractional length", () => {
    const text = `0.${"0".repeat(200)}1`;
    const value = DeterministicDecimal.parse(text, "value", {
      maxSignificantDigits: 256,
      maxInputLength: 1024,
    });
    expect(value.toExactString()).toBe(text);
    // The canonical text past the cutoff is the established double-rounded one.
    expect(value.toCanonicalString()).not.toBe(text);
    expect(Number(value.toCanonicalString())).toBeCloseTo(1e-201, 215);
    expect(() => DeterministicDecimal.of(1n, 3n).toExactString()).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.UNSAFE_NUMERIC_RANGE }),
    );
  });

  it("keeps the 0.3.0 Welch-Satterthwaite arithmetic bit-for-bit in the normal range", () => {
    // Contributions of a realistic mass model (two Type A, three Type B). The
    // scale-normalized form rounds one ulp differently (…644 vs …645), which
    // drifted k, U and the calculation fingerprint of recorded results.
    const variance = 0.0000730296743603715 ** 2;
    const contributions = [1.000000000066393e-9, 9.99999999782176e-10, 8.333333333333336e-10, 2.5e-9, 4.000000000265573e-18];
    const dofs = [4, 4, Infinity, Infinity, Infinity];
    const plain = (variance * variance) / (0 + (contributions[0]! * contributions[0]!) / 4 + (contributions[1]! * contributions[1]!) / 4);
    expect(welchSatterthwaiteDegreesOfFreedom(variance, contributions, dofs)).toBe(plain);
  });

  it("rejects a Welch-Satterthwaite term that overflows instead of reporting zero degrees of freedom", () => {
    expect(() =>
      welchSatterthwaiteDegreesOfFreedom(1, [1], [Number.MIN_VALUE]),
    ).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.INVALID_STATISTIC_INPUT }),
    );
    // Each term is finite (≈1e308) but their sum is not.
    expect(() =>
      welchSatterthwaiteDegreesOfFreedom(2, [1, 1], [2.5e-309, 2.5e-309]),
    ).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.INVALID_STATISTIC_INPUT }),
    );
  });
  it("evaluates a decimal model at the exact mean of lossy repeated observations", () => {
    // Exact mean 9007199254740995; its double rounds to ...996, which would make
    // the model read 16 with sensitivity 8 instead of 9 with sensitivity 6.
    const observations = ["9007199254740993", "9007199254740997"];
    const typeA = typeAFromRepeatedObservations(observations);
    expect(typeA.canonicalMean).toBe("9007199254740995");
    expect(typeA.mean).toBe(9007199254740996);

    const result = createCalculationEngine().evaluateMeasurementModel({
      formula: "(x-9007199254740992)^2",
      quantities: { x: { repeatedObservations: observations } },
    });
    expect(Number(result.value)).toBe(9);
    expect(Number(result.sensitivityCoefficients.x)).toBe(6);
  });

  it("leaves the double Type A path without a canonical mean", () => {
    // Observations a double carries keep the 0.3.0 mean arithmetic, so no exact
    // mean is offered that could displace it.
    const typeA = typeAFromRepeatedObservations([10.001, "10.002", "10.003"]);
    expect(typeA.canonicalMean).toBeUndefined();
    expect(typeA.mean).toBe(mean([10.001, 10.002, 10.003]));
  });

  it("evaluates derivatives exactly when a formula literal exceeds double precision", () => {
    // Every estimate round-trips through a double; the literal does not, and the
    // Number backend would round it to ...992 and report sensitivity 4.
    const result = createCalculationEngine().evaluateMeasurementModel({
      formula: "(x-9007199254740993)^2",
      quantities: {
        x: { estimate: "9007199254740994", standardUncertainty: 0.01 },
      },
    });
    expect(Number(result.value)).toBe(1);
    expect(Number(result.sensitivityCoefficients.x)).toBe(2);
  });

  it("renders a canonical text for a rational above the finite double range", () => {
    const value = DeterministicDecimal.of(10n ** 432n, 3n);
    expect(value.toCanonicalString()).toBe("3.333333333333333e431");
    expect(() => value.toNumber()).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.NON_FINITE_RESULT }),
    );
  });

  it("takes the Type A square root without narrowing the variance first", () => {
    // Variance ≈ 5e-401 narrows to zero; the standard deviation ≈ 7.07e-201 is
    // an ordinary double.
    const result = typeAFromRepeatedObservations(
      ["1.00000000000000001e-200", "2.00000000000000001e-200"],
      { maxExponentMagnitude: 200 },
    );
    expect(result.sampleStandardDeviation / 7.0710678e-201).toBeCloseTo(1, 7);
    expect(result.standardUncertainty / 5e-201).toBeCloseTo(1, 12);
  });

  it("normalizes when a Welch-Satterthwaite term underflows on division", () => {
    // The square is a normal double, but square / dof underflows to zero and the
    // plain form would read that contribution as carrying infinite information.
    expect(
      welchSatterthwaiteDegreesOfFreedom(1e-150, [1e-150], [1e24]) / 1e24,
    ).toBeCloseTo(1, 12);
  });
});
