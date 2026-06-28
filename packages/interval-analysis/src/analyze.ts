/**
 * Top-level interval analysis (Phase C classification + Phase D recommendation).
 * Spec: REQ-ENGINE-001/009/010/011 + REQ-ENGINE-REC-001..006. Pure + deterministic
 * (no wall-clock: the caller supplies each cycle's elapsed `tMonths`).
 *
 * The lab never attributes periodicity; this only PROPOSES — the customer applies.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import { analyzeMarginDrift } from "./drift.js";
import {
  clopperPearsonInterval,
  m5DeltaConfidenceInterval,
  m5Estimate,
  summarizeReliability,
  type CycleVerdict,
} from "./reliability.js";

export const ENGINE_VERSION = "0.1.0";

export type IntervalCycle = {
  verdict: CycleVerdict;
  /** As-found signed margins per measurement point (empty for UNKNOWN cycles). */
  margins: readonly number[];
  /** Elapsed months from the first cycle (caller-computed; keeps the engine pure). */
  tMonths: number;
};

export type IntervalConfig = {
  targetReliability: number; // R*
  confidence: number;
  minKnownCycles: number;
  minCoverage: number;
  k: number; // drift guard-band sigmas
  minMonths: number;
  maxMonths: number;
  minFamilyN: number; // min KNOWN family cycles for M5_family borrow-strength
};

export const DEFAULT_INTERVAL_CONFIG: IntervalConfig = {
  targetReliability: 0.9,
  confidence: 0.9,
  minKnownCycles: 3,
  minCoverage: 0.6,
  k: 2,
  minMonths: 1,
  maxMonths: 120,
  minFamilyN: 8,
};

export type Classification = "INSUFFICIENT_DATA" | "STABLE" | "DRIFTING";

export type Recommendation = {
  action: "extend" | "keep" | "shorten";
  method: "M2_drift" | "M5_reliability" | "M5_family";
  proposedIntervalMonths: number;
  /** The reliability bound that drove the decision (null for a drift-driven one). */
  reliabilityBound: number | null;
  /**
   * Delta-method confidence band on the M5 interval (months) — honest uncertainty for
   * a regulated suggestion (REQ-ENGINE-004b). Null for drift-driven (M2) recommendations.
   */
  intervalConfidence: { lower: number; upper: number } | null;
};

/** Aggregated family stats for M5 borrow-strength (REQ-ENGINE-FAMILY-001/004). */
export type FamilyStats = {
  populationN: number;
  conformingS: number;
  meanTimeSinceCalMonths: number;
};

export type IntervalAnalysis = {
  classification: Classification;
  reliability: number | null;
  coverage: number;
  recommendation: Recommendation | null;
  provenance: {
    engineVersion: string;
    config: IntervalConfig;
    /** SHA-256 over the engine version + config + cycle inputs (audit evidence). */
    fingerprint: string;
  };
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Floor to an integer month within bounds (REQ-ENGINE-009). The 1e-9 nudge absorbs
 * last-bit float noise so an exact 6.0 projection does not floor to 5 — "rounded down"
 * still holds for genuinely fractional values (4.694 → 4).
 */
function clampedMonths(raw: number, config: IntervalConfig): number {
  return clamp(Math.floor(raw + 1e-9), config.minMonths, config.maxMonths);
}

function fingerprint(
  cycles: readonly IntervalCycle[],
  config: IntervalConfig,
  family: FamilyStats | undefined,
): string {
  const canonical = JSON.stringify({
    v: ENGINE_VERSION,
    config,
    cycles: cycles.map((c) => ({ v: c.verdict, m: c.margins, t: c.tMonths })),
    // The family inputs drive the M5_family interval — include them so that path's
    // audit trail can reproduce the proposed number (§7.5).
    family: family ?? null,
  });
  return `sha256:${bytesToHex(sha256(utf8ToBytes(canonical)))}`;
}

/**
 * REQ-ENGINE-REC-001/002/003 + FAMILY-002/004: the reliability-based recommendation —
 * Clopper–Pearson CI vs R* drives extend/shorten/keep; the M5 interval is the proposal.
 * Shared by the single-unit (M5_reliability) and family (M5_family) paths.
 */
function reliabilityRecommendation(input: {
  conforming: number;
  known: number;
  meanTimeSinceCalMonths: number;
  currentIntervalMonths: number | null;
  config: IntervalConfig;
  method: "M5_reliability" | "M5_family";
}): Recommendation {
  const m5 = m5Estimate({
    populationN: input.known,
    conformingS: input.conforming,
    meanTimeSinceCalMonths: input.meanTimeSinceCalMonths,
    targetReliability: input.config.targetReliability,
  });
  const m5Interval = clampedMonths(m5.intervalMonths, input.config);
  const ci = clopperPearsonInterval(
    input.conforming,
    input.known,
    input.config.confidence,
  );
  const rawCi = m5DeltaConfidenceInterval({
    populationN: input.known,
    observedReliability: input.conforming / input.known,
    intervalMonths: m5.intervalMonths,
    confidence: input.config.confidence,
  });
  // Clamp the band to policy bounds so it never implies an out-of-policy interval.
  const intervalConfidence = {
    lower: clampedMonths(rawCi.lower, input.config),
    upper: clampedMonths(rawCi.upper, input.config),
  };
  if (ci.lower > input.config.targetReliability) {
    return {
      action: "extend",
      method: input.method,
      proposedIntervalMonths: m5Interval,
      reliabilityBound: ci.lower,
      intervalConfidence,
    };
  }
  if (ci.upper < input.config.targetReliability) {
    return {
      action: "shorten",
      method: input.method,
      proposedIntervalMonths: m5Interval,
      reliabilityBound: ci.upper,
      intervalConfidence,
    };
  }
  return {
    action: "keep",
    method: input.method,
    proposedIntervalMonths: input.currentIntervalMonths ?? m5Interval,
    reliabilityBound: ci.lower,
    intervalConfidence,
  };
}

export function analyzeInterval(input: {
  cycles: readonly IntervalCycle[];
  currentIntervalMonths: number | null;
  /** Aggregated family stats for borrow-strength when single-unit history is thin. */
  family?: FamilyStats;
  config?: Partial<IntervalConfig>;
}): IntervalAnalysis {
  const config: IntervalConfig = {
    ...DEFAULT_INTERVAL_CONFIG,
    ...input.config,
  };
  const provenance = {
    engineVersion: ENGINE_VERSION,
    config,
    fingerprint: fingerprint(input.cycles, config, input.family),
  };

  const summary = summarizeReliability(input.cycles.map((c) => c.verdict));
  const base = {
    reliability: summary.reliability,
    coverage: summary.coverage,
    provenance,
  };

  // REQ-MLR-050/051: the engine is regime-agnostic — it analyzes the customer-owned
  // calibration interval (Track 1) for EVERY instrument and never special-cases
  // legal-metrology. A legal instrument's regulation-fixed verification periodicity is a
  // separate track the engine does not see. (A purely-legal, never-calibrated instrument
  // simply has no KNOWN cycles → INSUFFICIENT_DATA below.)

  // REQ-ENGINE-001: too few KNOWN cycles OR too little coverage for the single unit.
  if (
    summary.known < config.minKnownCycles ||
    summary.coverage < config.minCoverage
  ) {
    // REQ-ENGINE-FAMILY-001: borrow strength from the family when it has enough history.
    if (input.family && input.family.populationN >= config.minFamilyN) {
      return {
        classification: "STABLE",
        recommendation: reliabilityRecommendation({
          conforming: input.family.conformingS,
          known: input.family.populationN,
          meanTimeSinceCalMonths: input.family.meanTimeSinceCalMonths,
          currentIntervalMonths: input.currentIntervalMonths,
          config,
          method: "M5_family",
        }),
        ...base,
      };
    }
    return {
      classification: "INSUFFICIENT_DATA",
      recommendation: null,
      ...base,
    };
  }

  // REQ-ENGINE-006/007: Method-2 drift on the margin series.
  const drift = analyzeMarginDrift(input.cycles, {
    confidence: config.confidence,
    k: config.k,
  });

  if (drift.drifting && drift.projectedMonths !== null) {
    // REQ-ENGINE-REC-004: a detected drift overrides any reliability-based extend.
    const proposed = clampedMonths(drift.projectedMonths, config);
    const action =
      input.currentIntervalMonths === null ||
      proposed < input.currentIntervalMonths
        ? "shorten"
        : "keep";
    return {
      classification: "DRIFTING",
      recommendation: {
        action,
        method: "M2_drift",
        proposedIntervalMonths: proposed,
        reliabilityBound: null,
        intervalConfidence: null,
      },
      ...base,
    };
  }

  // STABLE: REQ-ENGINE-REC-001/002/003 — reliability CI vs the target.
  const knownTimes = input.cycles
    .filter((c) => c.verdict !== "UNKNOWN")
    .map((c) => c.tMonths);
  const span = Math.max(...knownTimes) - Math.min(...knownTimes);
  const meanTimeSinceCalMonths =
    span > 0 ? span / (summary.known - 1) : config.minMonths;

  return {
    classification: "STABLE",
    recommendation: reliabilityRecommendation({
      conforming: summary.conforming,
      known: summary.known,
      meanTimeSinceCalMonths,
      currentIntervalMonths: input.currentIntervalMonths,
      config,
      method: "M5_reliability",
    }),
    ...base,
  };
}
