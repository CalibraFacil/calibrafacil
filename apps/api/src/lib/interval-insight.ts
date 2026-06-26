/**
 * Calibration-interval insight (Phase C0 transform + C2 response shaping).
 * Spec: `specs/calibration-interval-optimization-engine/spec.md`
 * (REQ-ENGINE-DATA-001, REQ-ENGINE-INSIGHT-001/002). Pure — the DB read happens in
 * the portal route; this maps the approved-job rows into the pure engine's input and
 * shapes the customer-facing payload (classification + recommendation + trend series).
 *
 * The interval is the customer's decision; this only PROPOSES. Legal-metrology assets
 * are handled by the engine (subjectToLegalMetrology → LEGAL_FIXED, no suggestion).
 */

import {
  analyzeInterval,
  type CycleVerdict,
  type IntervalConfig,
  type Recommendation,
} from "@calibra-facil/interval-analysis";

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.4375; // 365.25 / 12 days per month

export type ReliabilityJobRow = {
  approvedAt: Date | null;
  asFoundConformity: CycleVerdict | null;
  asFoundMargins: number[] | null;
};

export type IntervalInsightPoint = {
  approvedAt: string;
  conformity: CycleVerdict;
  /** Worst (minimum) as-found margin for the cycle, or null when none recorded. */
  minMargin: number | null;
};

export type IntervalInsight = {
  classification: "INSUFFICIENT_DATA" | "STABLE" | "DRIFTING" | "LEGAL_FIXED";
  reliability: number | null;
  coverage: number;
  recommendation: Recommendation | null;
  series: IntervalInsightPoint[];
  engineVersion: string;
  fingerprint: string;
};

function sortedDatedRows(
  rows: readonly ReliabilityJobRow[],
): (ReliabilityJobRow & { approvedAt: Date })[] {
  return rows
    .filter(
      (r): r is ReliabilityJobRow & { approvedAt: Date } =>
        r.approvedAt !== null,
    )
    .sort((a, b) => a.approvedAt.getTime() - b.approvedAt.getTime());
}

/** REQ-ENGINE-INSIGHT-001/002: build the customer-facing insight from approved jobs. */
export function buildIntervalInsight(input: {
  rows: readonly ReliabilityJobRow[];
  currentIntervalMonths: number | null;
  subjectToLegalMetrology: boolean;
  config?: Partial<IntervalConfig>;
}): IntervalInsight {
  const dated = sortedDatedRows(input.rows);
  const firstMs = dated[0]?.approvedAt.getTime() ?? 0;

  const cycles = dated.map((r) => ({
    verdict: r.asFoundConformity ?? "UNKNOWN",
    margins: r.asFoundMargins ?? [],
    tMonths: (r.approvedAt.getTime() - firstMs) / MS_PER_MONTH,
  }));

  const analysis = analyzeInterval({
    cycles,
    currentIntervalMonths: input.currentIntervalMonths,
    subjectToLegalMetrology: input.subjectToLegalMetrology,
    config: input.config,
  });

  const series: IntervalInsightPoint[] = dated.map((r) => ({
    approvedAt: r.approvedAt.toISOString(),
    conformity: r.asFoundConformity ?? "UNKNOWN",
    minMargin:
      r.asFoundMargins && r.asFoundMargins.length > 0
        ? Math.min(...r.asFoundMargins)
        : null,
  }));

  return {
    classification: analysis.classification,
    reliability: analysis.reliability,
    coverage: analysis.coverage,
    recommendation: analysis.recommendation,
    series,
    engineVersion: analysis.provenance.engineVersion,
    fingerprint: analysis.provenance.fingerprint,
  };
}
