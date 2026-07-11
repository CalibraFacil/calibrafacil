import { describe, expect, it } from "vitest";

import {
  classifyScore,
  enScore,
  zetaScore,
  zPrimeScore,
  zScore,
} from "./pt-scores";

describe("zScore", () => {
  // ISO 13528 §9.4: z = (x − x_pt) / σ_pt
  it("computes the standardized deviation", () => {
    expect(zScore(10.4, 10.0, 0.2)).toBeCloseTo(2.0, 10);
    expect(zScore(9.7, 10.0, 0.2)).toBeCloseTo(-1.5, 10);
  });
  it("returns null for non-positive sigma", () => {
    expect(zScore(10, 10, 0)).toBeNull();
    expect(zScore(10, 10, -1)).toBeNull();
  });
});

describe("zPrimeScore", () => {
  // §9.5: denominator inflated by the assigned-value uncertainty
  it("shrinks |z| relative to plain z when u(x_pt) > 0", () => {
    const z = zScore(10.4, 10.0, 0.2);
    const zPrime = zPrimeScore(10.4, 10.0, 0.2, 0.1);
    expect(zPrime).toBeCloseTo(0.4 / Math.sqrt(0.04 + 0.01), 10);
    expect(Math.abs(zPrime ?? 0)).toBeLessThan(Math.abs(z ?? 0));
  });
  it("equals z when the assigned value has no uncertainty", () => {
    expect(zPrimeScore(10.4, 10.0, 0.2, 0)).toBeCloseTo(2.0, 10);
  });
  it("returns null when both components are zero", () => {
    expect(zPrimeScore(10.4, 10.0, 0, 0)).toBeNull();
  });
});

describe("zetaScore", () => {
  // §9.6: standard uncertainties of lab and assigned value
  it("combines both standard uncertainties", () => {
    expect(zetaScore(10.3, 10.0, 0.1, 0.05)).toBeCloseTo(
      0.3 / Math.sqrt(0.01 + 0.0025),
      10,
    );
  });
  it("returns null when both uncertainties are zero", () => {
    expect(zetaScore(10.3, 10.0, 0, 0)).toBeNull();
  });
});

describe("enScore", () => {
  // §9.7: En with EXPANDED (k=2) uncertainties; |En| ≤ 1 is the criterion
  it("computes En from expanded uncertainties", () => {
    // Eurachem-style worked example: x=100.05, x_ref=100.00, U_lab=0.04, U_ref=0.03
    expect(enScore(100.05, 100.0, 0.04, 0.03)).toBeCloseTo(
      0.05 / Math.sqrt(0.0016 + 0.0009),
      10,
    );
  });
  it("is exactly 1 at the acceptance boundary", () => {
    expect(enScore(10.5, 10.0, 0.3, 0.4)).toBeCloseTo(1.0, 10);
  });
  it("returns null when both expanded uncertainties are zero", () => {
    expect(enScore(10.5, 10.0, 0, 0)).toBeNull();
  });
});

describe("classifyScore", () => {
  it("z-family: |z| ≤ 2 satisfactory, 2 < |z| < 3 questionable, |z| ≥ 3 unsatisfactory", () => {
    expect(classifyScore("z", 0)).toBe("satisfactory");
    expect(classifyScore("z", 2)).toBe("satisfactory");
    expect(classifyScore("z", -2)).toBe("satisfactory");
    expect(classifyScore("z", 2.5)).toBe("questionable");
    expect(classifyScore("z", -2.5)).toBe("questionable");
    expect(classifyScore("z", 3)).toBe("unsatisfactory");
    expect(classifyScore("z", -3.1)).toBe("unsatisfactory");
    expect(classifyScore("z_prime", 2.5)).toBe("questionable");
    expect(classifyScore("zeta", 2.5)).toBe("questionable");
  });
  it("En: |En| ≤ 1 satisfactory, otherwise unsatisfactory — no warning band", () => {
    expect(classifyScore("en", 0.99)).toBe("satisfactory");
    expect(classifyScore("en", 1)).toBe("satisfactory");
    expect(classifyScore("en", -1)).toBe("satisfactory");
    expect(classifyScore("en", 1.01)).toBe("unsatisfactory");
    expect(classifyScore("en", -1.5)).toBe("unsatisfactory");
  });
  it("non-finite scores never pass", () => {
    expect(classifyScore("z", Number.NaN)).toBe("unsatisfactory");
    expect(classifyScore("en", Number.POSITIVE_INFINITY)).toBe(
      "unsatisfactory",
    );
  });
});
