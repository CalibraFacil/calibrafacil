import { describe, expect, it } from "vitest";

import {
  clopperPearsonInterval,
  m5DeltaConfidenceInterval,
  m5Estimate,
  summarizeReliability,
} from "./reliability";

describe("summarizeReliability", () => {
  // REQ-ENGINE-002/003: UNKNOWN excluded from both numerator and denominator.
  it("excludes UNKNOWN from R and reports coverage", () => {
    const s = summarizeReliability([
      "CONFORMING",
      "CONFORMING",
      "NON_CONFORMING",
      "UNKNOWN",
    ]);
    expect(s.total).toBe(4);
    expect(s.known).toBe(3);
    expect(s.conforming).toBe(2);
    expect(s.reliability).toBeCloseTo(2 / 3, 10);
    expect(s.coverage).toBeCloseTo(0.75, 10);
  });
  it("reports null reliability when there are no KNOWN cycles", () => {
    const s = summarizeReliability(["UNKNOWN", "UNKNOWN"]);
    expect(s.reliability).toBeNull();
    expect(s.coverage).toBe(0);
  });
});

describe("m5Estimate (REQ-ENGINE-004 oracle)", () => {
  it("matches Jackson–Castrup: N=15,S=13,T=4.13333,R*=0.85 → λ₀=0.034621, i₀=4.694", () => {
    const e = m5Estimate({
      populationN: 15,
      conformingS: 13,
      meanTimeSinceCalMonths: 4.13333,
      targetReliability: 0.85,
    });
    expect(e.lambda0).toBeCloseTo(0.034621, 5);
    expect(e.intervalMonths).toBeCloseTo(4.694, 2);
  });
  // REQ-ENGINE-010 edge cases.
  it("R=1 → λ₀=0, interval=∞ (clamped to maxMonths by the caller)", () => {
    const e = m5Estimate({
      populationN: 10,
      conformingS: 10,
      meanTimeSinceCalMonths: 12,
      targetReliability: 0.9,
    });
    expect(e.lambda0).toBe(0);
    expect(e.intervalMonths).toBe(Number.POSITIVE_INFINITY);
  });
  it("R=0 → interval=0 (clamped to minMonths by the caller)", () => {
    const e = m5Estimate({
      populationN: 10,
      conformingS: 0,
      meanTimeSinceCalMonths: 12,
      targetReliability: 0.9,
    });
    expect(e.intervalMonths).toBe(0);
  });
});

describe("m5DeltaConfidenceInterval (REQ-ENGINE-004b oracle)", () => {
  it("gives the delta-method 90% CI [1.47, 15.04] for the REQ-ENGINE-004 inputs", () => {
    const ci = m5DeltaConfidenceInterval({
      populationN: 15,
      observedReliability: 13 / 15,
      intervalMonths: 4.694,
      confidence: 0.9,
    });
    expect(ci.lower).toBeCloseTo(1.47, 2);
    expect(ci.upper).toBeCloseTo(15.04, 1);
  });
});

describe("clopperPearsonInterval (REQ-ENGINE-FAMILY-003 oracle)", () => {
  it("gives [0.717, 0.982] for 18/20 at 90%", () => {
    const ci = clopperPearsonInterval(18, 20, 0.9);
    expect(ci.lower).toBeCloseTo(0.717, 3);
    expect(ci.upper).toBeCloseTo(0.982, 3);
  });
  it("pins the degenerate ends", () => {
    expect(clopperPearsonInterval(20, 20, 0.9).upper).toBe(1);
    expect(clopperPearsonInterval(0, 20, 0.9).lower).toBe(0);
  });
});
