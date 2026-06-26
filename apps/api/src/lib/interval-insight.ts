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
  type FamilyStats,
  type IntervalConfig,
  type Recommendation,
} from "@calibra-facil/interval-analysis";

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.4375; // 365.25 / 12 days per month

export type ReliabilityJobRow = {
  approvedAt: Date | null;
  asFoundConformity: CycleVerdict | null;
  asFoundMargins: number[] | null;
};

/** A family sibling's approved cycle (same assetType+model) for borrow-strength. */
export type FamilyJobRow = {
  assetId: number;
  approvedAt: Date | null;
  asFoundConformity: CycleVerdict | null;
};

/**
 * Aggregate family approved jobs into RP-1 stats (REQ-ENGINE-FAMILY-001/004): KNOWN
 * population, in-tolerance count, and the mean inter-calibration interval (months)
 * across the family — the engine's M5 `T`. Returns null when the family has no KNOWN cycle.
 */
export function buildFamilyStats(
  rows: readonly FamilyJobRow[],
): FamilyStats | null {
  const known = rows.filter(
    (r) =>
      r.asFoundConformity === "CONFORMING" ||
      r.asFoundConformity === "NON_CONFORMING",
  );
  if (known.length === 0) return null;

  const conformingS = known.filter(
    (r) => r.asFoundConformity === "CONFORMING",
  ).length;

  const datesByAsset = new Map<number, Date[]>();
  for (const r of known) {
    if (!r.approvedAt) continue;
    const list = datesByAsset.get(r.assetId) ?? [];
    list.push(r.approvedAt);
    datesByAsset.set(r.assetId, list);
  }

  const deltas: number[] = [];
  for (const dates of datesByAsset.values()) {
    dates.sort((a, b) => a.getTime() - b.getTime());
    for (let i = 1; i < dates.length; i += 1) {
      const prev = dates[i - 1];
      const curr = dates[i];
      if (prev && curr) {
        deltas.push((curr.getTime() - prev.getTime()) / MS_PER_MONTH);
      }
    }
  }
  const meanTimeSinceCalMonths =
    deltas.length > 0
      ? deltas.reduce((acc, d) => acc + d, 0) / deltas.length
      : 12; // no inter-cal interval observed yet → default annual cadence

  return { populationN: known.length, conformingS, meanTimeSinceCalMonths };
}

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
  /** Family siblings' approved cycles — the engine borrows strength when single-unit is thin. */
  familyRows?: readonly FamilyJobRow[];
  config?: Partial<IntervalConfig>;
}): IntervalInsight {
  const dated = sortedDatedRows(input.rows);
  const firstMs = dated[0]?.approvedAt.getTime() ?? 0;

  const cycles = dated.map((r) => ({
    verdict: r.asFoundConformity ?? "UNKNOWN",
    margins: r.asFoundMargins ?? [],
    tMonths: (r.approvedAt.getTime() - firstMs) / MS_PER_MONTH,
  }));

  const family = input.familyRows ? buildFamilyStats(input.familyRows) : null;

  const analysis = analyzeInterval({
    cycles,
    currentIntervalMonths: input.currentIntervalMonths,
    subjectToLegalMetrology: input.subjectToLegalMetrology,
    config: input.config,
    ...(family ? { family } : {}),
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
