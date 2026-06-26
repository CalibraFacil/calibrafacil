import { describe, expect, it } from "vitest";

import {
  analyzeMarginDrift,
  linearRegression,
  slopeIsSignificant,
} from "./drift";

describe("linearRegression", () => {
  it("recovers slope + intercept of a clean line", () => {
    const reg = linearRegression([
      { t: 0, y: 1 },
      { t: 1, y: 3 },
      { t: 2, y: 5 },
      { t: 3, y: 7 },
    ]);
    expect(reg?.slope).toBeCloseTo(2, 10);
    expect(reg?.intercept).toBeCloseTo(1, 10);
    expect(reg?.residualStdErr).toBeCloseTo(0, 10);
    expect(reg?.fittedAtLatest).toBeCloseTo(7, 10);
  });
  // REQ-ENGINE-005: residual dispersion s = √(Σresidual²/(n−2)) is non-trivial under scatter.
  it("computes non-zero residual dispersion for a scattered trend", () => {
    const reg = linearRegression([
      { t: 0, y: 0.5 },
      { t: 3, y: 0.3 },
      { t: 6, y: 0.35 },
      { t: 9, y: 0.1 },
      { t: 12, y: 0.05 },
    ]);
    expect(reg?.slope).toBeCloseTo(-0.03667, 4);
    expect(reg?.residualStdErr).toBeCloseTo(0.073, 3);
    expect(reg?.fittedAtLatest).toBeCloseTo(0.04, 4);
  });
  it("returns null below 3 points or with no time spread", () => {
    expect(
      linearRegression([
        { t: 0, y: 1 },
        { t: 1, y: 2 },
      ]),
    ).toBeNull();
    expect(
      linearRegression([
        { t: 5, y: 1 },
        { t: 5, y: 2 },
        { t: 5, y: 3 },
      ]),
    ).toBeNull();
  });
});

describe("slopeIsSignificant (REQ-ENGINE-006 no-drift guard)", () => {
  it("flags a clean trend as significant", () => {
    const reg = linearRegression([
      { t: 0, y: 1 },
      { t: 6, y: 0.8 },
      { t: 12, y: 0.6 },
      { t: 18, y: 0.4 },
      { t: 24, y: 0.2 },
    ]);
    expect(reg && slopeIsSignificant(reg, 0.9)).toBe(true);
  });
  it("does NOT flag a flat series (no drift) as significant", () => {
    const reg = linearRegression([
      { t: 0, y: 1 },
      { t: 6, y: 1 },
      { t: 12, y: 1 },
      { t: 18, y: 1 },
      { t: 24, y: 1 },
    ]);
    expect(reg && slopeIsSignificant(reg, 0.9)).toBe(false);
  });
});

describe("analyzeMarginDrift (REQ-ENGINE-007/008)", () => {
  // Margin falling linearly 1.0→0.2 over 24 months (slope −1/30); fitted m̄=0.2 at t=24;
  // with k=2 and ~0 dispersion, T_drift = 0.2 / (1/30) = 6 months.
  it("DRIFTING: projects months-to-limit for a falling margin", () => {
    const cycles = [0, 6, 12, 18, 24].map((tMonths, i) => ({
      tMonths,
      margins: [1.0 - 0.2 * i],
    }));
    const d = analyzeMarginDrift(cycles, { confidence: 0.9, k: 2 });
    expect(d.drifting).toBe(true);
    expect(d.projectedMonths).toBeCloseTo(6, 6);
  });
  // REQ-ENGINE-008: when the latest fitted margin is already inside the k·s guard band
  // (m̄ − k·s ≤ 0), the instrument is overdue per drift → T_drift floors to 0.
  it("projects T_drift=0 when already inside the guard band", () => {
    const cycles = [
      { tMonths: 0, margins: [0.5] },
      { tMonths: 3, margins: [0.3] },
      { tMonths: 6, margins: [0.35] },
      { tMonths: 9, margins: [0.1] },
      { tMonths: 12, margins: [0.05] },
    ];
    const d = analyzeMarginDrift(cycles, { confidence: 0.9, k: 2 });
    expect(d.drifting).toBe(true);
    expect(d.projectedMonths).toBe(0);
  });
  it("STABLE: a flat margin series is not drifting", () => {
    const cycles = [0, 6, 12, 18, 24].map((tMonths) => ({
      tMonths,
      margins: [1.0],
    }));
    const d = analyzeMarginDrift(cycles, { confidence: 0.9, k: 2 });
    expect(d.drifting).toBe(false);
    expect(d.projectedMonths).toBeNull();
  });
  it("never goes below 3 margin-bearing cycles", () => {
    const cycles = [
      { tMonths: 0, margins: [1.0] },
      { tMonths: 6, margins: [0.5] },
    ];
    expect(analyzeMarginDrift(cycles, { confidence: 0.9, k: 2 }).drifting).toBe(
      false,
    );
  });
});
