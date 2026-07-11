/**
 * Fleet reliability aggregation for the portal (#740 Track A).
 *
 * Pure functions over approved-job rows: OOT (as-found non-conforming) rates
 * trended by period, per-asset-type breakdown, worst offenders, and the
 * per-asset matched-point drift series. The DB reads live in the portal route
 * (same split as interval-insight.ts).
 *
 * Honesty rules (issue #740):
 * - Rates are computed over KNOWN cycles only (CONFORMING + NON_CONFORMING);
 *   the UNKNOWN share is always reported so analytics never overstate coverage.
 * - Jobs approved before asFoundConformity existed have null verdicts → UNKNOWN.
 * - Legal-metrology assets (metrologyRegime = LEGAL) follow the Inmetro
 *   verification regime, not ILAC-G24 reliability analysis — they are excluded
 *   from rates and reported separately as `legalExcluded`.
 * - The portal only DISPLAYS the lab's as-found verdict (ISO/IEC 17025 §7.8.6 /
 *   ILAC-G8); nothing here recomputes conformity.
 */

import {
  linearRegression,
  slopeIsSignificant,
  type RegressionResult,
} from "@calibra-facil/interval-analysis";

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.4375;

/** Confidence used for the drift-series slope test — matches drift.ts usage. */
export const DRIFT_SERIES_CONFIDENCE = 0.95;

export type FleetJobRow = {
  approvedAt: Date | null;
  asFoundConformity: "CONFORMING" | "NON_CONFORMING" | "UNKNOWN" | null;
  assetId: number;
  assetTag: string;
  assetName: string;
  assetTypeId: number;
  assetTypeName: string;
  metrologyRegime: "INDUSTRIAL" | "LEGAL" | "UNKNOWN";
};

export type FleetBucket = "quarter" | "year";

export type FleetRateSlice = {
  jobs: number;
  known: number;
  conforming: number;
  nonConforming: number;
  unknown: number;
  /** % of KNOWN cycles found non-conforming as-found; null when known = 0. */
  ootRatePct: number | null;
  /** % of cycles carrying an as-found signal. */
  coveragePct: number | null;
};

export type FleetTrendPoint = FleetRateSlice & { bucket: string };

export type FleetAssetTypeSlice = FleetRateSlice & {
  assetTypeId: number;
  assetTypeName: string;
};

export type FleetWorstOffender = {
  assetId: number;
  tag: string;
  name: string;
  assetTypeName: string;
  jobs: number;
  known: number;
  nonConforming: number;
  /** % of KNOWN cycles non-conforming; null when known = 0. */
  failureRatePct: number | null;
  lastNonConformingAt: string | null;
};

export type FleetReliabilitySummary = {
  totals: FleetRateSlice;
  /** Approved jobs on LEGAL-regime assets, excluded from every rate above. */
  legalExcluded: number;
  trend: FleetTrendPoint[];
  byAssetType: FleetAssetTypeSlice[];
  worstOffenders: FleetWorstOffender[];
};

function pct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function emptySlice(): FleetRateSlice {
  return {
    jobs: 0,
    known: 0,
    conforming: 0,
    nonConforming: 0,
    unknown: 0,
    ootRatePct: null,
    coveragePct: null,
  };
}

function accumulate(slice: FleetRateSlice, row: FleetJobRow): void {
  slice.jobs += 1;
  if (row.asFoundConformity === "CONFORMING") {
    slice.known += 1;
    slice.conforming += 1;
  } else if (row.asFoundConformity === "NON_CONFORMING") {
    slice.known += 1;
    slice.nonConforming += 1;
  } else {
    // null (pre-column jobs) counts as UNKNOWN
    slice.unknown += 1;
  }
}

function finalizeSlice(slice: FleetRateSlice): void {
  slice.ootRatePct = pct(slice.nonConforming, slice.known);
  slice.coveragePct = pct(slice.known, slice.jobs);
}

export function bucketKey(date: Date, bucket: FleetBucket): string {
  const year = date.getUTCFullYear();
  if (bucket === "year") return String(year);
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${year}-T${quarter}`;
}

export function buildFleetReliabilitySummary(
  rows: readonly FleetJobRow[],
  options: { bucket: FleetBucket; maxOffenders?: number },
): FleetReliabilitySummary {
  const totals = emptySlice();
  let legalExcluded = 0;
  const byBucket = new Map<string, FleetRateSlice>();
  const byType = new Map<number, FleetAssetTypeSlice>();
  const byAsset = new Map<
    number,
    FleetWorstOffender & { lastNonConformingMs: number | null }
  >();

  for (const row of rows) {
    if (row.metrologyRegime === "LEGAL") {
      legalExcluded += 1;
      continue;
    }
    if (!row.approvedAt) continue;

    accumulate(totals, row);

    const key = bucketKey(row.approvedAt, options.bucket);
    let bucketSlice = byBucket.get(key);
    if (!bucketSlice) {
      bucketSlice = emptySlice();
      byBucket.set(key, bucketSlice);
    }
    accumulate(bucketSlice, row);

    let typeSlice = byType.get(row.assetTypeId);
    if (!typeSlice) {
      typeSlice = {
        ...emptySlice(),
        assetTypeId: row.assetTypeId,
        assetTypeName: row.assetTypeName,
      };
      byType.set(row.assetTypeId, typeSlice);
    }
    accumulate(typeSlice, row);

    let offender = byAsset.get(row.assetId);
    if (!offender) {
      offender = {
        assetId: row.assetId,
        tag: row.assetTag,
        name: row.assetName,
        assetTypeName: row.assetTypeName,
        jobs: 0,
        known: 0,
        nonConforming: 0,
        failureRatePct: null,
        lastNonConformingAt: null,
        lastNonConformingMs: null,
      };
      byAsset.set(row.assetId, offender);
    }
    offender.jobs += 1;
    if (
      row.asFoundConformity === "CONFORMING" ||
      row.asFoundConformity === "NON_CONFORMING"
    ) {
      offender.known += 1;
    }
    if (row.asFoundConformity === "NON_CONFORMING") {
      offender.nonConforming += 1;
      const ms = row.approvedAt.getTime();
      if (offender.lastNonConformingMs === null || ms > offender.lastNonConformingMs) {
        offender.lastNonConformingMs = ms;
        offender.lastNonConformingAt = row.approvedAt.toISOString();
      }
    }
  }

  finalizeSlice(totals);
  for (const slice of byBucket.values()) finalizeSlice(slice);
  for (const slice of byType.values()) finalizeSlice(slice);

  const trend: FleetTrendPoint[] = [...byBucket.entries()]
    .map(([bucket, slice]) => ({ bucket, ...slice }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));

  const byAssetType = [...byType.values()].sort(
    (a, b) =>
      (b.ootRatePct ?? -1) - (a.ootRatePct ?? -1) ||
      b.nonConforming - a.nonConforming,
  );

  const worstOffenders = [...byAsset.values()]
    .filter((offender) => offender.nonConforming > 0)
    .map((offender) => {
      const { lastNonConformingMs: _drop, ...rest } = offender;
      return {
        ...rest,
        failureRatePct: pct(offender.nonConforming, offender.known),
      };
    })
    .sort(
      (a, b) =>
        b.nonConforming - a.nonConforming ||
        (b.failureRatePct ?? 0) - (a.failureRatePct ?? 0),
    )
    .slice(0, options.maxOffenders ?? 10);

  return { totals, legalExcluded, trend, byAssetType, worstOffenders };
}

// ---------------------------------------------------------------------------
// Per-asset drift series (Track A item 3)
// ---------------------------------------------------------------------------

export type DriftSeriesJobRow = {
  approvedAt: Date | null;
  asFoundConformity: "CONFORMING" | "NON_CONFORMING" | "UNKNOWN" | null;
  asFoundMargins: number[] | null;
};

export type DriftSeriesPoint = {
  approvedAt: string;
  margin: number;
};

export type DriftSeriesEntry = {
  /** Positional index of the measured point across cycles (drift.ts semantics). */
  pointIndex: number;
  series: DriftSeriesPoint[];
  /** OLS regression of the signed margin toward the 0 limit; null when n < 3. */
  regression: {
    slope: number;
    intercept: number;
    residualStdErr: number;
    fittedAtLatest: number;
    significant: boolean;
  } | null;
  /** Significant negative slope — heading toward the tolerance limit. */
  drifting: boolean;
};

export type AssetDriftSeries = {
  cycles: Array<{
    approvedAt: string;
    conformity: "CONFORMING" | "NON_CONFORMING" | "UNKNOWN";
    minMargin: number | null;
  }>;
  points: DriftSeriesEntry[];
  coverage: { totalCycles: number; cyclesWithMargins: number };
};

/**
 * Same collapse discipline as interval-insight.ts: drop undated rows, sort
 * ascending, keep the latest cycle per UTC day.
 */
function sortedDatedDriftRows(
  rows: readonly DriftSeriesJobRow[],
): Array<DriftSeriesJobRow & { approvedAt: Date }> {
  const dated = rows.filter(
    (r): r is DriftSeriesJobRow & { approvedAt: Date } => r.approvedAt !== null,
  );
  const sorted = [...dated].sort(
    (a, b) => a.approvedAt.getTime() - b.approvedAt.getTime(),
  );
  const byDay = new Map<string, DriftSeriesJobRow & { approvedAt: Date }>();
  for (const row of sorted) {
    byDay.set(row.approvedAt.toISOString().slice(0, 10), row);
  }
  return [...byDay.values()];
}

/**
 * Builds the matched-point signed-margin series the drift chart plots — the
 * exact data drift.ts regresses (per-point OLS toward margin = 0; margins are
 * never aggregated across points). Points are matched positionally by array
 * index across cycles, which assumes a stable method point order (documented
 * limitation shared with drift.ts).
 */
export function buildAssetDriftSeries(
  rows: readonly DriftSeriesJobRow[],
): AssetDriftSeries {
  const dated = sortedDatedDriftRows(rows);
  const firstMs = dated[0]?.approvedAt.getTime() ?? 0;
  const withMargins = dated.filter(
    (r) => (r.asFoundMargins?.length ?? 0) > 0,
  );

  const cycles = dated.map((r) => ({
    approvedAt: r.approvedAt.toISOString(),
    conformity: r.asFoundConformity ?? ("UNKNOWN" as const),
    minMargin:
      r.asFoundMargins && r.asFoundMargins.length > 0
        ? Math.min(...r.asFoundMargins)
        : null,
  }));

  const maxPoints = withMargins.reduce(
    (acc, r) => Math.max(acc, r.asFoundMargins?.length ?? 0),
    0,
  );

  const points: DriftSeriesEntry[] = [];
  for (let j = 0; j < maxPoints; j += 1) {
    const matched = withMargins.filter(
      (r) => j < (r.asFoundMargins?.length ?? 0),
    );
    const series = matched.map((r) => ({
      approvedAt: r.approvedAt.toISOString(),
      margin: r.asFoundMargins?.[j] ?? 0,
    }));
    const regressionInput = matched.map((r) => ({
      t: (r.approvedAt.getTime() - firstMs) / MS_PER_MONTH,
      y: r.asFoundMargins?.[j] ?? 0,
    }));
    const reg: RegressionResult | null = linearRegression(regressionInput);
    const significant = reg
      ? slopeIsSignificant(reg, DRIFT_SERIES_CONFIDENCE)
      : false;
    points.push({
      pointIndex: j,
      series,
      regression: reg
        ? {
            slope: reg.slope,
            intercept: reg.intercept,
            residualStdErr: reg.residualStdErr,
            fittedAtLatest: reg.fittedAtLatest,
            significant,
          }
        : null,
      drifting: reg !== null && significant && reg.slope < 0,
    });
  }

  return {
    cycles,
    points,
    coverage: {
      totalCycles: dated.length,
      cyclesWithMargins: withMargins.length,
    },
  };
}
