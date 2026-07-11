import { describe, expect, it } from "vitest";

import {
  buildAssetDriftSeries,
  buildFleetReliabilitySummary,
  bucketKey,
  type FleetJobRow,
} from "./portal-fleet-reliability";

function row(overrides: Partial<FleetJobRow>): FleetJobRow {
  return {
    approvedAt: new Date("2026-01-15T12:00:00Z"),
    asFoundConformity: "CONFORMING",
    assetId: 1,
    assetTag: "EQ-1",
    assetName: "Balança",
    assetTypeId: 10,
    assetTypeName: "Balança",
    metrologyRegime: "INDUSTRIAL",
    ...overrides,
  };
}

describe("bucketKey", () => {
  it("buckets by quarter and year (UTC)", () => {
    expect(bucketKey(new Date("2026-01-15T00:00:00Z"), "quarter")).toBe(
      "2026-T1",
    );
    expect(bucketKey(new Date("2026-12-31T23:00:00Z"), "quarter")).toBe(
      "2026-T4",
    );
    expect(bucketKey(new Date("2026-06-01T00:00:00Z"), "year")).toBe("2026");
  });
});

describe("buildFleetReliabilitySummary", () => {
  it("computes rates over KNOWN cycles only and reports the UNKNOWN share", () => {
    const summary = buildFleetReliabilitySummary(
      [
        row({ asFoundConformity: "CONFORMING" }),
        row({ asFoundConformity: "CONFORMING" }),
        row({ asFoundConformity: "NON_CONFORMING" }),
        row({ asFoundConformity: "UNKNOWN" }),
        // pre-column job: null verdict must count as UNKNOWN
        row({ asFoundConformity: null }),
      ],
      { bucket: "quarter" },
    );
    expect(summary.totals.jobs).toBe(5);
    expect(summary.totals.known).toBe(3);
    expect(summary.totals.unknown).toBe(2);
    // 1 non-conforming of 3 known = 33.3%
    expect(summary.totals.ootRatePct).toBeCloseTo(33.3, 5);
    // 3 of 5 with signal = 60%
    expect(summary.totals.coveragePct).toBeCloseTo(60, 5);
  });

  it("excludes LEGAL-regime assets from every rate and counts them separately", () => {
    const summary = buildFleetReliabilitySummary(
      [
        row({ asFoundConformity: "NON_CONFORMING" }),
        row({
          asFoundConformity: "NON_CONFORMING",
          metrologyRegime: "LEGAL",
          assetId: 2,
        }),
      ],
      { bucket: "year" },
    );
    expect(summary.totals.jobs).toBe(1);
    expect(summary.legalExcluded).toBe(1);
    expect(summary.worstOffenders).toHaveLength(1);
    expect(summary.worstOffenders[0]?.assetId).toBe(1);
  });

  it("returns null rates for an empty fleet instead of fake zeros", () => {
    const summary = buildFleetReliabilitySummary([], { bucket: "quarter" });
    expect(summary.totals.jobs).toBe(0);
    expect(summary.totals.ootRatePct).toBeNull();
    expect(summary.totals.coveragePct).toBeNull();
    expect(summary.trend).toEqual([]);
    expect(summary.worstOffenders).toEqual([]);
  });

  it("null rate when every cycle is UNKNOWN (no as-found signal at all)", () => {
    const summary = buildFleetReliabilitySummary(
      [row({ asFoundConformity: "UNKNOWN" }), row({ asFoundConformity: null })],
      { bucket: "quarter" },
    );
    expect(summary.totals.ootRatePct).toBeNull();
    expect(summary.totals.coveragePct).toBe(0);
  });

  it("trends chronologically by bucket", () => {
    const summary = buildFleetReliabilitySummary(
      [
        row({
          approvedAt: new Date("2025-11-01T00:00:00Z"),
          asFoundConformity: "NON_CONFORMING",
        }),
        row({ approvedAt: new Date("2026-02-01T00:00:00Z") }),
        row({ approvedAt: new Date("2026-05-01T00:00:00Z") }),
      ],
      { bucket: "quarter" },
    );
    expect(summary.trend.map((t) => t.bucket)).toEqual([
      "2025-T4",
      "2026-T1",
      "2026-T2",
    ]);
    expect(summary.trend[0]?.ootRatePct).toBe(100);
    expect(summary.trend[1]?.ootRatePct).toBe(0);
  });

  it("ranks worst offenders by failure count then rate, capped at maxOffenders", () => {
    const rows: FleetJobRow[] = [
      // asset 1: 2 failures of 3 known
      row({ assetId: 1, assetTag: "EQ-1", asFoundConformity: "NON_CONFORMING" }),
      row({
        assetId: 1,
        assetTag: "EQ-1",
        asFoundConformity: "NON_CONFORMING",
        approvedAt: new Date("2026-03-01T00:00:00Z"),
      }),
      row({ assetId: 1, assetTag: "EQ-1" }),
      // asset 2: 1 failure of 1 known (higher rate, lower count)
      row({ assetId: 2, assetTag: "EQ-2", asFoundConformity: "NON_CONFORMING" }),
      // asset 3: clean — must not appear
      row({ assetId: 3, assetTag: "EQ-3" }),
    ];
    const summary = buildFleetReliabilitySummary(rows, {
      bucket: "year",
      maxOffenders: 1,
    });
    expect(summary.worstOffenders).toHaveLength(1);
    expect(summary.worstOffenders[0]?.assetId).toBe(1);
    expect(summary.worstOffenders[0]?.failureRatePct).toBeCloseTo(66.7, 5);
    expect(summary.worstOffenders[0]?.lastNonConformingAt).toBe(
      "2026-03-01T00:00:00.000Z",
    );
  });
});

describe("buildAssetDriftSeries", () => {
  const day = (iso: string) => new Date(iso);

  it("builds per-point matched series with regression when n >= 3", () => {
    const result = buildAssetDriftSeries([
      {
        approvedAt: day("2024-01-01T00:00:00Z"),
        asFoundConformity: "CONFORMING",
        asFoundMargins: [0.5, 0.9],
      },
      {
        approvedAt: day("2025-01-01T00:00:00Z"),
        asFoundConformity: "CONFORMING",
        asFoundMargins: [0.3, 0.9],
      },
      {
        approvedAt: day("2026-01-01T00:00:00Z"),
        asFoundConformity: "CONFORMING",
        asFoundMargins: [0.1, 0.9],
      },
    ]);
    expect(result.points).toHaveLength(2);
    const first = result.points[0];
    expect(first?.series).toHaveLength(3);
    expect(first?.regression).not.toBeNull();
    // margin falls 0.2/year toward 0 → negative slope, clean fit → drifting
    expect(first?.regression?.slope).toBeLessThan(0);
    expect(first?.drifting).toBe(true);
    // stable second point must not drift
    expect(result.points[1]?.drifting).toBe(false);
    expect(result.coverage).toEqual({ totalCycles: 3, cyclesWithMargins: 3 });
  });

  it("no regression with fewer than 3 matched cycles (drift.ts semantics)", () => {
    const result = buildAssetDriftSeries([
      {
        approvedAt: day("2025-01-01T00:00:00Z"),
        asFoundConformity: "CONFORMING",
        asFoundMargins: [0.5],
      },
      {
        approvedAt: day("2026-01-01T00:00:00Z"),
        asFoundConformity: "CONFORMING",
        asFoundMargins: [0.3],
      },
    ]);
    expect(result.points[0]?.regression).toBeNull();
    expect(result.points[0]?.drifting).toBe(false);
  });

  it("degrades honestly: margin-less cycles appear in coverage, not in series", () => {
    const result = buildAssetDriftSeries([
      {
        approvedAt: day("2025-01-01T00:00:00Z"),
        asFoundConformity: "UNKNOWN",
        asFoundMargins: null,
      },
      {
        approvedAt: day("2026-01-01T00:00:00Z"),
        asFoundConformity: "CONFORMING",
        asFoundMargins: [0.4],
      },
    ]);
    expect(result.coverage).toEqual({ totalCycles: 2, cyclesWithMargins: 1 });
    expect(result.cycles).toHaveLength(2);
    expect(result.cycles[0]?.minMargin).toBeNull();
    expect(result.points[0]?.series).toHaveLength(1);
  });

  it("collapses same-UTC-day cycles keeping the latest", () => {
    const result = buildAssetDriftSeries([
      {
        approvedAt: day("2026-01-01T08:00:00Z"),
        asFoundConformity: "CONFORMING",
        asFoundMargins: [0.5],
      },
      {
        approvedAt: day("2026-01-01T17:00:00Z"),
        asFoundConformity: "NON_CONFORMING",
        asFoundMargins: [-0.1],
      },
    ]);
    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0]?.conformity).toBe("NON_CONFORMING");
  });
});
