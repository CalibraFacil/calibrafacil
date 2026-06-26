import { describe, expect, it } from "vitest";

import { analyzeInterval, type IntervalCycle } from "./analyze";
import type { CycleVerdict } from "./reliability";

function cyc(
  verdict: CycleVerdict,
  margin: number | null,
  t: number,
): IntervalCycle {
  return { verdict, margins: margin === null ? [] : [margin], tMonths: t };
}

const R85 = { targetReliability: 0.85 };

describe("analyzeInterval — classification gates", () => {
  // REQ-ENGINE-001: fewer than minKnownCycles KNOWN cycles.
  it("INSUFFICIENT_DATA below minKnownCycles", () => {
    const a = analyzeInterval({
      cycles: [cyc("CONFORMING", 0.5, 0), cyc("CONFORMING", 0.5, 6)],
      currentIntervalMonths: 12,
      subjectToLegalMetrology: false,
    });
    expect(a.classification).toBe("INSUFFICIENT_DATA");
    expect(a.recommendation).toBeNull();
  });

  // REQ-ENGINE-001: enough KNOWN cycles but coverage below minCoverage (0.6).
  it("INSUFFICIENT_DATA below minCoverage (3 known of 6)", () => {
    const a = analyzeInterval({
      cycles: [
        cyc("CONFORMING", 0.5, 0),
        cyc("CONFORMING", 0.5, 6),
        cyc("CONFORMING", 0.5, 12),
        cyc("UNKNOWN", null, 18),
        cyc("UNKNOWN", null, 24),
        cyc("UNKNOWN", null, 30),
      ],
      currentIntervalMonths: 12,
      subjectToLegalMetrology: false,
    });
    expect(a.classification).toBe("INSUFFICIENT_DATA");
    expect(a.coverage).toBeCloseTo(0.5, 10);
  });

  // REQ-ENGINE-REC-006 / INSIGHT-002: legal-metrology is regulation-fixed.
  it("LEGAL_FIXED with no recommendation", () => {
    const a = analyzeInterval({
      cycles: Array.from({ length: 10 }, (_, i) =>
        cyc("CONFORMING", 0.5, i * 6),
      ),
      currentIntervalMonths: 12,
      subjectToLegalMetrology: true,
    });
    expect(a.classification).toBe("LEGAL_FIXED");
    expect(a.recommendation).toBeNull();
  });
});

describe("analyzeInterval — STABLE recommendation (REQ-ENGINE-REC-001/002/003)", () => {
  it("extends when the reliability lower bound clears R*", () => {
    const a = analyzeInterval({
      cycles: Array.from({ length: 20 }, (_, i) =>
        cyc("CONFORMING", 0.5, i * 6),
      ),
      currentIntervalMonths: 12,
      subjectToLegalMetrology: false,
      config: R85,
    });
    expect(a.classification).toBe("STABLE");
    expect(a.recommendation?.action).toBe("extend");
    expect(a.recommendation?.method).toBe("M5_reliability");
    // REQ-ENGINE-009/010: R=1 → M5 interval ∞ → clamped to maxMonths (120).
    expect(a.recommendation?.proposedIntervalMonths).toBe(120);
    // REQ-ENGINE-REC-005: the driving reliability bound is reported.
    expect(a.recommendation?.reliabilityBound ?? 0).toBeGreaterThan(0.85);
  });

  // REQ-ENGINE-010/009: R=0 → M5 interval 0 → clamped UP to minMonths (1).
  it("shortens to minMonths when reliability is 0", () => {
    const a = analyzeInterval({
      cycles: Array.from({ length: 10 }, (_, i) =>
        cyc("NON_CONFORMING", -0.1, i * 6),
      ),
      currentIntervalMonths: 12,
      subjectToLegalMetrology: false,
      config: R85,
    });
    expect(a.classification).toBe("STABLE");
    expect(a.recommendation?.action).toBe("shorten");
    expect(a.recommendation?.proposedIntervalMonths).toBe(1);
  });

  it("shortens when the reliability upper bound is below R*", () => {
    // 12 cycles alternating in/out of tolerance → R=0.5; the point margin oscillates
    // (no significant slope) so it stays STABLE, not DRIFTING.
    const cycles = Array.from({ length: 12 }, (_, i) =>
      i % 2 === 0
        ? cyc("CONFORMING", 0.5, i * 6)
        : cyc("NON_CONFORMING", -0.1, i * 6),
    );
    const a = analyzeInterval({
      cycles,
      currentIntervalMonths: 12,
      subjectToLegalMetrology: false,
      config: R85,
    });
    expect(a.classification).toBe("STABLE");
    expect(a.recommendation?.action).toBe("shorten");
  });

  it("keeps the current interval when the CI straddles R*", () => {
    // 8 of 10 conforming (R=0.8), failures in the middle → STABLE + straddling CI.
    const cycles: IntervalCycle[] = Array.from({ length: 10 }, (_, i) =>
      i === 3 || i === 6
        ? cyc("NON_CONFORMING", -0.1, i * 6)
        : cyc("CONFORMING", 0.5, i * 6),
    );
    const a = analyzeInterval({
      cycles,
      currentIntervalMonths: 9,
      subjectToLegalMetrology: false,
      config: R85,
    });
    expect(a.classification).toBe("STABLE");
    expect(a.recommendation?.action).toBe("keep");
    expect(a.recommendation?.proposedIntervalMonths).toBe(9);
  });
});

describe("analyzeInterval — DRIFTING overrides extend (REQ-ENGINE-REC-004)", () => {
  it("a falling margin shortens even when every cycle is in tolerance", () => {
    // All CONFORMING (R=1, which alone would extend), but the margin falls 1.0→0.2.
    const cycles = [0, 6, 12, 18, 24].map((t, i) =>
      cyc("CONFORMING", 1.0 - 0.2 * i, t),
    );
    const a = analyzeInterval({
      cycles,
      currentIntervalMonths: 12,
      subjectToLegalMetrology: false,
      config: R85,
    });
    expect(a.classification).toBe("DRIFTING");
    expect(a.recommendation?.method).toBe("M2_drift");
    expect(a.recommendation?.action).toBe("shorten");
    expect(a.recommendation?.action).not.toBe("extend");
    // REQ-ENGINE-REC-005: exact-6.0 projection floors to 6 (FP-noise robust), not 5.
    expect(a.recommendation?.proposedIntervalMonths).toBe(6);
  });
});

describe("analyzeInterval — family borrow-strength (REQ-ENGINE-FAMILY-001)", () => {
  it("uses the family (M5_family) when single-unit history is thin", () => {
    const a = analyzeInterval({
      cycles: [cyc("CONFORMING", 0.5, 0)], // 1 known < minKnownCycles(3)
      currentIntervalMonths: 12,
      subjectToLegalMetrology: false,
      family: { populationN: 30, conformingS: 30, meanTimeSinceCalMonths: 12 },
      config: R85,
    });
    expect(a.classification).toBe("STABLE");
    expect(a.recommendation?.method).toBe("M5_family");
    expect(a.recommendation?.action).toBe("extend");
    expect(a.recommendation?.proposedIntervalMonths).toBe(120);
  });

  it("falls back to INSUFFICIENT_DATA when the family is also below minFamilyN", () => {
    const a = analyzeInterval({
      cycles: [cyc("CONFORMING", 0.5, 0)],
      currentIntervalMonths: 12,
      subjectToLegalMetrology: false,
      family: { populationN: 5, conformingS: 4, meanTimeSinceCalMonths: 12 },
    });
    expect(a.classification).toBe("INSUFFICIENT_DATA");
    expect(a.recommendation).toBeNull();
  });
});

describe("analyzeInterval — provenance (REQ-ENGINE-011)", () => {
  it("records the engine version, config snapshot, and a fingerprint", () => {
    const a = analyzeInterval({
      cycles: [cyc("CONFORMING", 0.5, 0)],
      currentIntervalMonths: null,
      subjectToLegalMetrology: false,
    });
    expect(a.provenance.engineVersion).toBe("0.1.0");
    expect(a.provenance.config.targetReliability).toBe(0.9);
    expect(a.provenance.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
