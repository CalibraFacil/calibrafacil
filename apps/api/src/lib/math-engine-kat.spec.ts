import { describe, it, expect } from "vitest";
import {
  typeAFromRepeatedObservations,
  typeBStandardUncertainty,
  coverageFactorForProbability,
  studentTQuantile,
  welchSatterthwaiteDegreesOfFreedom,
  createCalculationEngine,
  ENGINE_VERSION,
} from "@calibra-facil/math-engine";

/**
 * Known-answer tests (KAT) against the REAL @calibra-facil/math-engine.
 *
 * The engine is a vendored workspace package (v0.4.0) and its own test suite is
 * NOT mirrored into this repo — every other GUM test here injects a fake engine.
 * These textbook reference values are the only in-repo guard against a silent
 * GUM-math regression when ENGINE_VERSION is bumped: if any of these fail in CI,
 * the upgraded engine produced a wrong number.
 *
 * See .goals/claim-code-parity.md (B4) and
 * docs/estrategia/precificacao-posicionamento.md (A5 — validation dossier).
 *
 * All expected values are hand-verifiable from JCGM 100:2008 (GUM):
 *   - Type A standard uncertainty of the mean = s / √n, dof = n − 1
 *   - Type B divisors: rectangular ÷√3, triangular ÷√6
 *   - coverage factor k = t_{(1+p)/2}(ν_eff); k → z_{0.975} = 1.95996 as ν → ∞
 *   - Welch–Satterthwaite ν_eff = u_c⁴ / Σ(u_i⁴ / ν_i)
 */

const SQRT3 = Math.sqrt(3);
const SQRT6 = Math.sqrt(6);

describe("@calibra-facil/math-engine — GUM known-answer tests (real engine)", () => {
  it("pins the engine version this KAT was validated against", () => {
    // Bump this deliberately together with the engine tag in package.json so a
    // surprise upgrade is visible in the diff and re-validates the numbers.
    expect(ENGINE_VERSION).toBe("0.4.0");
  });

  it("Type A: mean, sample s, standard uncertainty s/√n, dof = n − 1", () => {
    const a = typeAFromRepeatedObservations([9.8, 10.0, 10.2]);
    expect(Number(a.mean)).toBeCloseTo(10, 10);
    expect(Number(a.sampleStandardDeviation)).toBeCloseTo(0.2, 10);
    expect(Number(a.standardUncertainty)).toBeCloseTo(0.2 / SQRT3, 10);
    expect(a.degreesOfFreedom).toBe(2);
  });

  it("Type B rectangular uses divisor √3", () => {
    const b = typeBStandardUncertainty({
      distribution: "rectangular",
      halfWidth: 0.003,
    });
    expect(Number(b.standardUncertainty)).toBeCloseTo(0.003 / SQRT3, 12);
    expect(Number(b.divisor)).toBeCloseTo(SQRT3, 12);
  });

  it("Type B triangular uses divisor √6", () => {
    const b = typeBStandardUncertainty({
      distribution: "triangular",
      halfWidth: 0.003,
    });
    expect(Number(b.standardUncertainty)).toBeCloseTo(0.003 / SQRT6, 12);
    expect(Number(b.divisor)).toBeCloseTo(SQRT6, 12);
  });

  it("coverage factor at 95% with infinite dof is the normal quantile z₀.₉₇₅ ≈ 1.95996", () => {
    expect(coverageFactorForProbability(0.95, Infinity)).toBeCloseTo(
      1.959964,
      5,
    );
  });

  it("coverage factor at 95% with 10 dof equals Student-t t(0.975, 10) ≈ 2.22814", () => {
    expect(coverageFactorForProbability(0.95, 10)).toBeCloseTo(2.228139, 5);
    expect(studentTQuantile(0.975, 10)).toBeCloseTo(2.228139, 5);
  });

  it("Welch–Satterthwaite: two equal contributions (u=1, ν=10) give ν_eff = 20", () => {
    // u_c² = 2, contribution variances [1,1], dofs [10,10] → 2² / (1/10 + 1/10) = 20
    expect(welchSatterthwaiteDegreesOfFreedom(2, [1, 1], [10, 10])).toBeCloseTo(
      20,
      9,
    );
  });

  it("full measurement model (y = x, Type-A only) reproduces k = t(0.975, 2) = 4.30265", () => {
    const engine = createCalculationEngine();
    const r = engine.evaluateMeasurementModel({
      formula: "x",
      quantities: {
        x: { estimate: 10, repeatedObservations: [9.8, 10.0, 10.2] },
      },
      coverageProbability: 0.95,
    });
    expect(Number(r.value)).toBeCloseTo(10, 10);
    expect(Number(r.combinedStandardUncertainty)).toBeCloseTo(0.2 / SQRT3, 10);
    expect(Number(r.effectiveDegreesOfFreedom)).toBe(2);
    expect(Number(r.coverageFactor)).toBeCloseTo(4.30265, 4);
    expect(Number(r.expandedUncertainty)).toBeCloseTo(
      (0.2 / SQRT3) * 4.30265273,
      6,
    );
  });
});
