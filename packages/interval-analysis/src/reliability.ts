/**
 * Reliability (NCSL RP-1 / ILAC-G24 Method 5) — observed reliability, the exponential
 * interval model, the delta-method CI, and the Clopper–Pearson exact-binomial CI.
 * Spec: `specs/calibration-interval-optimization-engine/spec.md`
 * (REQ-ENGINE-003/004/004b/010, REQ-ENGINE-FAMILY-002/003). Pure + deterministic.
 *
 * AS-FOUND is the reliability signal; `UNKNOWN` cycles are excluded from BOTH the
 * numerator and the denominator of R (never counted as failures — that would infer
 * failure from absent data) and reported only via coverage.
 */

import { inverseRegularizedIncompleteBeta, normalQuantile } from "./special.js";

export type CycleVerdict = "CONFORMING" | "NON_CONFORMING" | "UNKNOWN";

export type ReliabilitySummary = {
  /** Total cycles considered. */
  total: number;
  /** KNOWN cycles (CONFORMING + NON_CONFORMING) — the denominator of R. */
  known: number;
  /** CONFORMING (in-tolerance as-found) KNOWN cycles — the numerator of R. */
  conforming: number;
  /** Observed reliability R = conforming / known (null when no KNOWN cycles). */
  reliability: number | null;
  /** Coverage = known / total (0 when there are no cycles). */
  coverage: number;
};

/** REQ-ENGINE-002/003: summarize R + coverage, excluding UNKNOWN from R. */
export function summarizeReliability(
  verdicts: readonly CycleVerdict[],
): ReliabilitySummary {
  const total = verdicts.length;
  const known = verdicts.filter((v) => v !== "UNKNOWN").length;
  const conforming = verdicts.filter((v) => v === "CONFORMING").length;
  return {
    total,
    known,
    conforming,
    reliability: known === 0 ? null : conforming / known,
    coverage: total === 0 ? 0 : known / total,
  };
}

export type M5Estimate = {
  /** Failure-rate estimate λ₀ = −(1/T)·ln(S/N) (per month). */
  lambda0: number;
  /** Raw recommended interval i₀ = −ln(R*)/λ₀ (months, UNCLAMPED). */
  intervalMonths: number;
};

/**
 * REQ-ENGINE-004/010: the exponential reliability-target interval. Returns the RAW
 * (unclamped) interval; the caller clamps to policy bounds (REQ-ENGINE-009). Edge
 * cases: R=1 ⇒ λ₀=0, interval=∞ (→ maxMonths after clamp); R=0 ⇒ λ₀=∞, interval=0
 * (→ minMonths after clamp).
 */
export function m5Estimate(input: {
  populationN: number;
  conformingS: number;
  meanTimeSinceCalMonths: number;
  targetReliability: number;
}): M5Estimate {
  const r = input.conformingS / input.populationN;
  if (r >= 1) {
    return { lambda0: 0, intervalMonths: Number.POSITIVE_INFINITY };
  }
  if (r <= 0) {
    return { lambda0: Number.POSITIVE_INFINITY, intervalMonths: 0 };
  }
  const lambda0 = -Math.log(r) / input.meanTimeSinceCalMonths;
  const intervalMonths = -Math.log(input.targetReliability) / lambda0;
  return { lambda0, intervalMonths };
}

export type Interval = { lower: number; upper: number };

/**
 * REQ-ENGINE-004b: log-normal delta-method CI on the M5 interval.
 * SE(ln i₀) = √[(1−R)/(N·R·(ln R)²)], CI = i₀·exp(∓ z·SE), R = observed S/N.
 */
export function m5DeltaConfidenceInterval(input: {
  populationN: number;
  observedReliability: number;
  intervalMonths: number;
  confidence: number;
}): Interval {
  const r = input.observedReliability;
  if (r <= 0 || r >= 1) {
    return { lower: input.intervalMonths, upper: input.intervalMonths };
  }
  const variance =
    (1 - r) / (input.populationN * r * Math.log(r) * Math.log(r));
  const se = Math.sqrt(variance);
  const z = normalQuantile(0.5 * (1 + input.confidence));
  return {
    lower: input.intervalMonths * Math.exp(-z * se),
    upper: input.intervalMonths * Math.exp(z * se),
  };
}

/**
 * REQ-ENGINE-FAMILY-002/003: two-sided Clopper–Pearson exact-binomial CI for x
 * in-tolerance out of n, at `confidence`. R_L = BetaInv(α/2; x, n−x+1),
 * R_U = BetaInv(1−α/2; x+1, n−x); degenerate ends pin to 0 / 1.
 */
export function clopperPearsonInterval(
  conforming: number,
  total: number,
  confidence: number,
): Interval {
  const alpha = 1 - confidence;
  const lower =
    conforming <= 0
      ? 0
      : inverseRegularizedIncompleteBeta(
          alpha / 2,
          conforming,
          total - conforming + 1,
        );
  const upper =
    conforming >= total
      ? 1
      : inverseRegularizedIncompleteBeta(
          1 - alpha / 2,
          conforming + 1,
          total - conforming,
        );
  return { lower, upper };
}
