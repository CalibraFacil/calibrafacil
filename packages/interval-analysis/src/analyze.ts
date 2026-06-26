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
};

export const DEFAULT_INTERVAL_CONFIG: IntervalConfig = {
  targetReliability: 0.9,
  confidence: 0.9,
  minKnownCycles: 3,
  minCoverage: 0.6,
  k: 2,
  minMonths: 1,
  maxMonths: 120,
};

export type Classification =
  | "INSUFFICIENT_DATA"
  | "STABLE"
  | "DRIFTING"
  | "LEGAL_FIXED";

export type Recommendation = {
  action: "extend" | "keep" | "shorten";
  method: "M2_drift" | "M5_reliability";
  proposedIntervalMonths: number;
  /** The reliability bound that drove the decision (null for a drift-driven one). */
  reliabilityBound: number | null;
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
  subjectToLegalMetrology: boolean,
): string {
  const canonical = JSON.stringify({
    v: ENGINE_VERSION,
    config,
    legal: subjectToLegalMetrology,
    cycles: cycles.map((c) => ({ v: c.verdict, m: c.margins, t: c.tMonths })),
  });
  return `sha256:${bytesToHex(sha256(utf8ToBytes(canonical)))}`;
}

export function analyzeInterval(input: {
  cycles: readonly IntervalCycle[];
  currentIntervalMonths: number | null;
  subjectToLegalMetrology: boolean;
  config?: Partial<IntervalConfig>;
}): IntervalAnalysis {
  const config: IntervalConfig = {
    ...DEFAULT_INTERVAL_CONFIG,
    ...input.config,
  };
  const provenance = {
    engineVersion: ENGINE_VERSION,
    config,
    fingerprint: fingerprint(
      input.cycles,
      config,
      input.subjectToLegalMetrology,
    ),
  };

  const summary = summarizeReliability(input.cycles.map((c) => c.verdict));
  const base = {
    reliability: summary.reliability,
    coverage: summary.coverage,
    provenance,
  };

  // REQ-ENGINE-REC-006 / INSIGHT-002: legal-metrology is regulation-fixed.
  if (input.subjectToLegalMetrology) {
    return { classification: "LEGAL_FIXED", recommendation: null, ...base };
  }

  // REQ-ENGINE-001: too few KNOWN cycles OR too little coverage → no recommendation.
  if (
    summary.known < config.minKnownCycles ||
    summary.coverage < config.minCoverage
  ) {
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
  const m5 = m5Estimate({
    populationN: summary.known,
    conformingS: summary.conforming,
    meanTimeSinceCalMonths,
    targetReliability: config.targetReliability,
  });
  const m5Interval = clampedMonths(m5.intervalMonths, config);
  const ci = clopperPearsonInterval(
    summary.conforming,
    summary.known,
    config.confidence,
  );

  let action: Recommendation["action"];
  let reliabilityBound: number;
  let proposed: number;
  if (ci.lower > config.targetReliability) {
    action = "extend";
    reliabilityBound = ci.lower;
    proposed = m5Interval;
  } else if (ci.upper < config.targetReliability) {
    action = "shorten";
    reliabilityBound = ci.upper;
    proposed = m5Interval;
  } else {
    action = "keep";
    reliabilityBound = ci.lower;
    proposed =
      input.currentIntervalMonths === null
        ? m5Interval
        : input.currentIntervalMonths;
  }

  return {
    classification: "STABLE",
    recommendation: {
      action,
      method: "M5_reliability",
      proposedIntervalMonths: proposed,
      reliabilityBound,
    },
    ...base,
  };
}
