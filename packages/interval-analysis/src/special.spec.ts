import { describe, expect, it } from "vitest";

import {
  inverseRegularizedIncompleteBeta,
  logGamma,
  normalQuantile,
  regularizedIncompleteBeta,
  tCriticalTwoSided,
} from "./special";

describe("logGamma", () => {
  it("matches known factorials: Γ(n) = (n-1)!", () => {
    expect(Math.exp(logGamma(5))).toBeCloseTo(24, 6); // 4!
    expect(Math.exp(logGamma(6))).toBeCloseTo(120, 5); // 5!
    // Γ(1/2) = √π
    expect(Math.exp(logGamma(0.5))).toBeCloseTo(Math.sqrt(Math.PI), 8);
  });
});

describe("regularizedIncompleteBeta", () => {
  it("is 0.5 at x=0.5 for the symmetric Beta(1/2,1/2)", () => {
    expect(regularizedIncompleteBeta(0.5, 0.5, 0.5)).toBeCloseTo(0.5, 8);
  });
  it("clamps the endpoints", () => {
    expect(regularizedIncompleteBeta(0, 2, 3)).toBe(0);
    expect(regularizedIncompleteBeta(1, 2, 3)).toBe(1);
  });
  it("matches a known value I_0.5(2,3) = 0.6875", () => {
    expect(regularizedIncompleteBeta(0.5, 2, 3)).toBeCloseTo(0.6875, 8);
  });
});

describe("inverseRegularizedIncompleteBeta", () => {
  it("round-trips: I_{inv(p)}(a,b) = p", () => {
    for (const [p, a, b] of [
      [0.05, 18, 3],
      [0.95, 19, 2],
      [0.3, 4, 7],
    ] as const) {
      const x = inverseRegularizedIncompleteBeta(p, a, b);
      expect(regularizedIncompleteBeta(x, a, b)).toBeCloseTo(p, 6);
    }
  });
  // The two Clopper–Pearson endpoints used by REQ-ENGINE-FAMILY-003 (n=20, x=18, 90%).
  it("computes the Clopper–Pearson endpoints for 18/20 at 90%", () => {
    expect(inverseRegularizedIncompleteBeta(0.05, 18, 3)).toBeCloseTo(0.717, 3);
    expect(inverseRegularizedIncompleteBeta(0.95, 19, 2)).toBeCloseTo(0.982, 3);
  });
});

describe("tCriticalTwoSided", () => {
  it("matches t-table values", () => {
    expect(tCriticalTwoSided(0.95, 10)).toBeCloseTo(2.228, 3);
    expect(tCriticalTwoSided(0.95, 1)).toBeCloseTo(12.706, 2);
    expect(tCriticalTwoSided(0.9, 1_000_000)).toBeCloseTo(1.645, 3);
  });
});

describe("normalQuantile", () => {
  it("matches standard-normal quantiles", () => {
    expect(normalQuantile(0.95)).toBeCloseTo(1.6449, 3);
    expect(normalQuantile(0.975)).toBeCloseTo(1.95996, 3);
    expect(normalQuantile(0.5)).toBeCloseTo(0, 6);
  });
});
