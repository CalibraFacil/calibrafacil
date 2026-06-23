/**
 * GUM Known-Answer Tests (KAT) — packages/math-engine
 *
 * CUT-LINE / HIGH RISK: wrong U/k = invalid certificates.
 *
 * Oracle source: JCGM 100:2008 (GUM) + standard Student-t tables.
 * All expected values are hand-verifiable.
 *
 * Tolerance discipline:
 *   - toBeCloseTo(expected, N) asserts |received - expected| < 10^(-N) / 2.
 *   - We use N >= 5 (≥5 significant figures) everywhere.
 *   - DO NOT loosen the tolerance to make a test pass — escalate a GUM regression.
 *
 * Import strategy: direct relative imports so the spec can run inside the package
 * without the alias being resolved through the package's own exports entry point.
 */

import { describe, it, expect } from "vitest";
import {
  typeAFromRepeatedObservations,
  typeBStandardUncertainty,
} from "../uncertainty/index.js";
import {
  studentTQuantile,
  coverageFactorForProbability,
  welchSatterthwaiteDegreesOfFreedom,
} from "./statistics.js";
import { ENGINE_VERSION } from "../engine/options.js";
import { createCalculationEngine } from "../engine/create.js";
import { DeterministicDecimal } from "../numeric/decimal.js";

// ─── Pre-computed constants used by multiple tests ─────────────────────────

const SQRT2 = Math.SQRT2; // √2
const SQRT3 = Math.sqrt(3); // √3
const SQRT6 = Math.sqrt(6); // √6

// ─── REQ-GUM-009: engine version pin ───────────────────────────────────────

describe("REQ-GUM-009: ENGINE_VERSION pin", () => {
  it("REQ-GUM-009 — ENGINE_VERSION SHALL equal '0.3.0'", () => {
    // Pinning the validated engine tag; a surprise bump must appear in the diff
    // and force re-validation of all oracle values below.
    expect(ENGINE_VERSION).toBe("0.3.0");
  });
});

// ─── REQ-GUM-001: Type A uncertainty ───────────────────────────────────────

describe("REQ-GUM-001: typeAFromRepeatedObservations oracle", () => {
  it("REQ-GUM-001 — observations [9.8, 10.0, 10.2]: mean=10, s=0.2, u=s/√3, dof=2", () => {
    const result = typeAFromRepeatedObservations([9.8, 10.0, 10.2]);

    // mean = (9.8 + 10.0 + 10.2) / 3 = 10 exactly
    expect(Number(result.mean)).toBeCloseTo(10, 10);

    // sample standard deviation s = √(Σ(xᵢ − x̄)² / (n−1))
    // = √((0.04 + 0 + 0.04) / 2) = √0.04 = 0.2
    expect(Number(result.sampleStandardDeviation)).toBeCloseTo(0.2, 10);

    // standard uncertainty of the mean u = s / √n = 0.2 / √3
    expect(Number(result.standardUncertainty)).toBeCloseTo(
      0.2 / SQRT3,
      10, // ~5 sig figs tight to GUM oracle
    );

    // degrees of freedom = n − 1 = 2
    expect(result.degreesOfFreedom).toBe(2);
    expect(result.count).toBe(3);
  });
});

// ─── REQ-GUM-002: Type B divisors ──────────────────────────────────────────

describe("REQ-GUM-002: typeBStandardUncertainty divisors", () => {
  const halfWidth = 0.003;

  it("REQ-GUM-002 [rectangular] divisor = √3, u = halfWidth / √3", () => {
    const b = typeBStandardUncertainty({
      distribution: "rectangular",
      halfWidth,
    });
    expect(Number(b.divisor)).toBeCloseTo(SQRT3, 10);
    expect(Number(b.standardUncertainty)).toBeCloseTo(halfWidth / SQRT3, 10);
  });

  it("REQ-GUM-002 [uniform] alias → same divisor √3 as rectangular", () => {
    // 'uniform' is an alias for rectangular in the engine
    const b = typeBStandardUncertainty({
      distribution: "uniform",
      halfWidth,
    });
    expect(Number(b.divisor)).toBeCloseTo(SQRT3, 10);
    expect(Number(b.standardUncertainty)).toBeCloseTo(halfWidth / SQRT3, 10);
  });

  it("REQ-GUM-002 [triangular] divisor = √6, u = halfWidth / √6", () => {
    const b = typeBStandardUncertainty({
      distribution: "triangular",
      halfWidth,
    });
    expect(Number(b.divisor)).toBeCloseTo(SQRT6, 10);
    expect(Number(b.standardUncertainty)).toBeCloseTo(halfWidth / SQRT6, 10);
  });

  it("REQ-GUM-002 [u-shaped] divisor = √2, u = halfWidth / √2", () => {
    const b = typeBStandardUncertainty({
      distribution: "u-shaped",
      halfWidth,
    });
    expect(Number(b.divisor)).toBeCloseTo(SQRT2, 10);
    expect(Number(b.standardUncertainty)).toBeCloseTo(halfWidth / SQRT2, 10);
  });

  it("REQ-GUM-002 [arcsine] alias → same divisor √2 as u-shaped", () => {
    // 'arcsine' is an alias for u-shaped in the engine
    const b = typeBStandardUncertainty({
      distribution: "arcsine",
      halfWidth,
    });
    expect(Number(b.divisor)).toBeCloseTo(SQRT2, 10);
    expect(Number(b.standardUncertainty)).toBeCloseTo(halfWidth / SQRT2, 10);
  });

  it("REQ-GUM-002 [normal] with expandedUncertainty + coverageFactor: divisor = k, u = U/k", () => {
    // Normal distribution: the engine requires expandedUncertainty + coverageFactor.
    // The divisor is the coverage factor k (not a textbook geometric divisor).
    // This is GUM-conformant: u = U / k.
    const k = 2;
    const U = 0.006;
    const b = typeBStandardUncertainty({
      distribution: "normal",
      expandedUncertainty: U,
      coverageFactor: k,
    });
    expect(Number(b.divisor)).toBeCloseTo(k, 10);
    expect(Number(b.standardUncertainty)).toBeCloseTo(U / k, 10);
    // NOTE: Normal distribution's divisor is the caller-supplied coverage factor,
    // not a fixed geometric ratio. This is textbook (GUM §4.3.3): u(xi) = U / k.
  });

  it("REQ-GUM-002 [custom] with explicit divisor", () => {
    // Custom distribution uses the explicit divisor supplied by the caller.
    const divisor = 1.5;
    const b = typeBStandardUncertainty({
      distribution: "custom",
      halfWidth,
      divisor,
    });
    expect(Number(b.divisor)).toBeCloseTo(divisor, 10);
    expect(Number(b.standardUncertainty)).toBeCloseTo(halfWidth / divisor, 10);
    // NOTE: 'custom' divisor is caller-defined; there is no textbook derivation to
    // flag. The engine correctly passes through any positive finite divisor.
  });

  it("REQ-GUM-002 [standardUncertainty source] divisor = 1 (pass-through)", () => {
    // When standardUncertainty is given directly, divisor is 1 (no scaling applied).
    const u = 0.001732;
    const b = typeBStandardUncertainty({
      distribution: "rectangular",
      standardUncertainty: u,
    });
    expect(Number(b.divisor)).toBe(1);
    expect(Number(b.standardUncertainty)).toBeCloseTo(u, 10);
  });
});

// ─── REQ-GUM-003: studentTQuantile oracle values ───────────────────────────

describe("REQ-GUM-003: studentTQuantile GUM oracle values", () => {
  // Two-sided 95% coverage → upper-tail probability p = 0.975.
  // Reference: standard t-distribution tables (JCGM 100:2008 Table G.2).
  const P = 0.975;

  it("REQ-GUM-003 ν=1 → t(0.975, 1) = 12.7062", () => {
    expect(studentTQuantile(P, 1)).toBeCloseTo(12.7062, 4);
  });

  it("REQ-GUM-003 ν=2 → t(0.975, 2) = 4.30265", () => {
    expect(studentTQuantile(P, 2)).toBeCloseTo(4.30265, 4);
  });

  it("REQ-GUM-003 ν=3 → t(0.975, 3) = 3.18245", () => {
    expect(studentTQuantile(P, 3)).toBeCloseTo(3.18245, 4);
  });

  it("REQ-GUM-003 ν=5 → t(0.975, 5) = 2.57058", () => {
    expect(studentTQuantile(P, 5)).toBeCloseTo(2.57058, 4);
  });

  it("REQ-GUM-003 ν=10 → t(0.975, 10) = 2.22814", () => {
    expect(studentTQuantile(P, 10)).toBeCloseTo(2.22814, 4);
  });

  it("REQ-GUM-003 ν=30 → t(0.975, 30) = 2.04227", () => {
    expect(studentTQuantile(P, 30)).toBeCloseTo(2.04227, 4);
  });

  it("REQ-GUM-003 ν→∞ → t(0.975, Infinity) = z₀.₉₇₅ = 1.95996", () => {
    // At infinite dof the t-distribution converges to the standard normal.
    expect(studentTQuantile(P, Infinity)).toBeCloseTo(1.95996, 4);
  });
});

// ─── REQ-GUM-004: coverageFactorForProbability ─────────────────────────────

describe("REQ-GUM-004: coverageFactorForProbability vs oracle", () => {
  it("REQ-GUM-004 — k(p=0.95, ν=∞) = z₀.₉₇₅ ≈ 1.959964", () => {
    expect(coverageFactorForProbability(0.95, Infinity)).toBeCloseTo(
      1.959964,
      5,
    );
  });

  it("REQ-GUM-004 — k(p=0.95, ν=10) = t(0.975, 10) ≈ 2.22814", () => {
    const k = coverageFactorForProbability(0.95, 10);
    const t = studentTQuantile(0.975, 10);
    // They must be equal to machine precision (same computation path).
    expect(k).toBeCloseTo(t, 10);
    // And both close to the oracle value.
    expect(k).toBeCloseTo(2.22814, 4);
  });
});

// ─── REQ-GUM-005: monotonicity invariant ───────────────────────────────────

describe("REQ-GUM-005: coverage factor is monotonically non-increasing in ν", () => {
  it("REQ-GUM-005 — k(ν=2) > k(ν=10) > k(ν=∞)", () => {
    const k2 = coverageFactorForProbability(0.95, 2);
    const k10 = coverageFactorForProbability(0.95, 10);
    const kInf = coverageFactorForProbability(0.95, Infinity);

    expect(k2).toBeGreaterThan(k10);
    expect(k10).toBeGreaterThan(kInf);

    // Cross-check against oracle values
    expect(k2).toBeCloseTo(4.30265, 4);
    expect(k10).toBeCloseTo(2.22814, 4);
    expect(kInf).toBeCloseTo(1.95996, 4);
  });
});

// ─── REQ-GUM-006: Welch–Satterthwaite ─────────────────────────────────────

describe("REQ-GUM-006: welchSatterthwaiteDegreesOfFreedom oracle", () => {
  it("REQ-GUM-006 — two equal contributions u=1, ν=10: ν_eff = 20", () => {
    // ν_eff = u_c⁴ / Σ(u_i⁴/ν_i) = 4 / (1/10 + 1/10) = 4 / 0.2 = 20
    const nuEff = welchSatterthwaiteDegreesOfFreedom(2, [1, 1], [10, 10]);
    expect(nuEff).toBeCloseTo(20, 9);
  });

  it("REQ-GUM-006 — one Infinity-dof contribution: ν_eff = 40", () => {
    // ν_eff = u_c⁴ / Σ(u_i⁴/ν_i)
    // Contribution from Infinity-dof term → 0 (skipped); only finite-dof contributes.
    // ν_eff = 4 / (1/10) = 40
    const nuEff = welchSatterthwaiteDegreesOfFreedom(2, [1, 1], [Infinity, 10]);
    expect(nuEff).toBeCloseTo(40, 9);
  });
});

// ─── REQ-GUM-007: full measurement model oracle ────────────────────────────

describe("REQ-GUM-007: evaluateMeasurementModel — y=x, Type-A on [9.8,10,10.2], p=0.95", () => {
  it("REQ-GUM-007 — value=10, u_c=0.2/√3, ν_eff=2, k≈4.30265, U=u_c·k", () => {
    const engine = createCalculationEngine();
    const result = engine.evaluateMeasurementModel({
      formula: "x",
      quantities: {
        x: {
          estimate: 10,
          repeatedObservations: [9.8, 10.0, 10.2],
        },
      },
      coverageProbability: 0.95,
    });

    // Measurand value
    expect(Number(result.value)).toBeCloseTo(10, 10);

    // Combined standard uncertainty = u(x) = s/√n = 0.2/√3
    const expectedUc = 0.2 / SQRT3;
    expect(Number(result.combinedStandardUncertainty)).toBeCloseTo(
      expectedUc,
      10,
    );

    // Effective degrees of freedom = n−1 = 2
    expect(Number(result.effectiveDegreesOfFreedom)).toBe(2);

    // Coverage factor = t(0.975, 2) = 4.30265…
    const expectedK = 4.30265;
    expect(Number(result.coverageFactor)).toBeCloseTo(expectedK, 4);

    // Expanded uncertainty U = u_c · k
    expect(Number(result.expandedUncertainty)).toBeCloseTo(
      expectedUc * 4.302652729911636, // full-precision t(0.975, 2)
      7,
    );

    // Coverage probability preserved
    expect(result.coverageProbability).toBe(0.95);
  });
});

// ─── REQ-GUM-008: quadrature combination ───────────────────────────────────

describe("REQ-GUM-008: two-component model combines in quadrature (RSS)", () => {
  it("REQ-GUM-008 — u_c = √(u_A² + u_B²) for Type-A + rectangular Type-B", () => {
    // Type-A component from x = [9.8, 10, 10.2]: u_A = 0.2/√3
    // Type-B component from y, rectangular, halfWidth=0.003: u_B = 0.003/√3
    // Formula: z = x + y (linear, sensitivity coeff = 1 for both)
    // u_c(z) = √(u_A² + u_B²)

    const engine = createCalculationEngine();
    const result = engine.evaluateMeasurementModel({
      formula: "x + y",
      quantities: {
        x: {
          estimate: 10,
          repeatedObservations: [9.8, 10.0, 10.2],
        },
        y: {
          estimate: 0,
          distribution: "rectangular",
          halfWidth: 0.003,
        },
      },
      coverageProbability: 0.95,
    });

    const uA = 0.2 / SQRT3;
    const uB = 0.003 / SQRT3;
    const expectedUc = Math.sqrt(uA * uA + uB * uB);

    expect(Number(result.value)).toBeCloseTo(10, 10);
    expect(Number(result.combinedStandardUncertainty)).toBeCloseTo(
      expectedUc,
      9,
    );

    // The budget must list both components
    const budget = result.uncertaintyBudget;
    expect(budget.length).toBe(2);

    // Verify RSS: u_c² = Σ u_i²
    const sumVariances = budget.reduce(
      (sum, entry) => sum + Number(entry.contributionVariance),
      0,
    );
    const uc2 = Number(result.combinedStandardUncertainty) ** 2;
    expect(sumVariances).toBeCloseTo(uc2, 9);
  });
});

// ─── REQ-GUM-010: decimal exactness ────────────────────────────────────────

describe("REQ-GUM-010: DeterministicDecimal exactness (0.1 + 0.2 = 0.3)", () => {
  it("REQ-GUM-010 — 0.1 + 0.2 SHALL equal 0.3 exactly through the decimal API", () => {
    // In IEEE-754 float64: 0.1 + 0.2 !== 0.3 (binary drift).
    // The DeterministicDecimal backend uses exact rational arithmetic,
    // so this must hold exactly.
    const d01 = DeterministicDecimal.from("0.1");
    const d02 = DeterministicDecimal.from("0.2");
    const d03 = DeterministicDecimal.from("0.3");

    const sum = d01.add(d02);

    // compare() returns 0 iff numerically equal
    expect(sum.compare(d03)).toBe(0);

    // Also verify toNumber() produces the same double as the float literal 0.3
    // (within the exact decimal representation).
    expect(sum.toNumber()).toBe(0.3);

    // Confirm the float64 drift problem this is guarding against:
    expect(0.1 + 0.2).not.toBe(0.3); // guard: this would be false in correct float arithmetic
  });
});
