/**
 * ILAC-G24 Method 2 (control-chart) drift on the AS-FOUND signed-margin series.
 * Spec: REQ-ENGINE-005/006/007/008. Pure + deterministic.
 *
 * Raw per-point MPE is not stored, but the signed margin already encodes "distance to
 * the tolerance limit" — `margin = 0` IS the limit. So drift is the regression of a
 * matched point's margin toward 0 over time; the engine NEVER aggregates margins across
 * points (no MPE to normalize by), it regresses each point independently.
 */

import { tCriticalTwoSided } from "./special.js";

export type RegressionResult = {
  n: number;
  slope: number;
  intercept: number;
  /** Residual standard error s = √(Σresidual² / (n−2)). */
  residualStdErr: number;
  /** Standard error of the slope = s / √Σ(t−t̄)². */
  slopeStdErr: number;
  /** Regression-fitted margin at the latest observation time (m̄). */
  fittedAtLatest: number;
};

/** Ordinary least squares of y on t. Returns null when n<3 or t has no spread. */
export function linearRegression(
  points: readonly { t: number; y: number }[],
): RegressionResult | null {
  const n = points.length;
  if (n < 3) return null;
  const tBar = points.reduce((acc, p) => acc + p.t, 0) / n;
  const yBar = points.reduce((acc, p) => acc + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.t - tBar) * (p.t - tBar);
    sxy += (p.t - tBar) * (p.y - yBar);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = yBar - slope * tBar;
  let sse = 0;
  for (const p of points) {
    const resid = p.y - (intercept + slope * p.t);
    sse += resid * resid;
  }
  const residualStdErr = Math.sqrt(sse / (n - 2));
  const slopeStdErr = residualStdErr / Math.sqrt(sxx);
  const latestT = points.reduce(
    (acc, p) => Math.max(acc, p.t),
    points[0]?.t ?? 0,
  );
  return {
    n,
    slope,
    intercept,
    residualStdErr,
    slopeStdErr,
    fittedAtLatest: intercept + slope * latestT,
  };
}

/** REQ-ENGINE-006: slope distinguishable from 0 ⇔ |b| > t*·SE(b) (two-sided). */
export function slopeIsSignificant(
  reg: RegressionResult,
  confidence: number,
): boolean {
  const tCrit = tCriticalTwoSided(confidence, reg.n - 2);
  return Math.abs(reg.slope) > tCrit * reg.slopeStdErr;
}

export type DriftResult = {
  drifting: boolean;
  /** Projected months until the worst drifting point reaches the limit (null if stable). */
  projectedMonths: number | null;
};

/**
 * REQ-ENGINE-006/007/008: per-point drift over the cycle series. A point is drifting
 * when its slope is significant AND negative (margin heading toward the 0 limit). The
 * projected time-to-limit is `min over drifting points of (m̄ − k·s)/|b|`, floored at 0.
 */
export function analyzeMarginDrift(
  cycles: readonly { tMonths: number; margins: readonly number[] }[],
  options: { confidence: number; k: number },
): DriftResult {
  const withMargins = cycles.filter((c) => c.margins.length > 0);
  if (withMargins.length < 3) return { drifting: false, projectedMonths: null };

  const maxPoints = withMargins.reduce(
    (acc, c) => Math.max(acc, c.margins.length),
    0,
  );
  let drifting = false;
  let projected = Number.POSITIVE_INFINITY;

  for (let j = 0; j < maxPoints; j += 1) {
    const series = withMargins
      .filter((c) => j < c.margins.length)
      .map((c) => ({ t: c.tMonths, y: c.margins[j] ?? 0 }));
    const reg = linearRegression(series);
    if (!reg) continue;
    if (slopeIsSignificant(reg, options.confidence) && reg.slope < 0) {
      drifting = true;
      const months = Math.max(
        0,
        (reg.fittedAtLatest - options.k * reg.residualStdErr) /
          Math.abs(reg.slope),
      );
      projected = Math.min(projected, months);
    }
  }

  return drifting
    ? { drifting: true, projectedMonths: projected }
    : { drifting: false, projectedMonths: null };
}
