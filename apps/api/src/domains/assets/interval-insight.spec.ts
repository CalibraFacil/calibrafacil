import { describe, expect, it } from "vitest";

import {
  buildFamilyStats,
  buildIntervalInsight,
  type ReliabilityJobRow,
} from "./interval-insight";

function row(
  iso: string,
  conformity: ReliabilityJobRow["asFoundConformity"],
  margins: number[] | null,
): ReliabilityJobRow {
  return {
    approvedAt: new Date(iso),
    asFoundConformity: conformity,
    asFoundMargins: margins,
  };
}

describe("buildIntervalInsight", () => {
  // Falling margin across ~6-month cycles → DRIFTING (mirrors the engine, through the row map).
  it("classifies a falling margin as DRIFTING and shapes the trend series", () => {
    const rows = [
      row("2024-01-01T00:00:00.000Z", "CONFORMING", [1.0]),
      row("2024-07-01T00:00:00.000Z", "CONFORMING", [0.8]),
      row("2025-01-01T00:00:00.000Z", "CONFORMING", [0.6]),
      row("2025-07-01T00:00:00.000Z", "CONFORMING", [0.4]),
      row("2026-01-01T00:00:00.000Z", "CONFORMING", [0.2]),
    ];
    const insight = buildIntervalInsight({
      rows,
      currentIntervalMonths: 12,
    });
    expect(insight.classification).toBe("DRIFTING");
    expect(insight.recommendation?.action).toBe("shorten");
    expect(insight.series).toHaveLength(5);
    expect(insight.series[0]).toEqual({
      approvedAt: "2024-01-01T00:00:00.000Z",
      conformity: "CONFORMING",
      minMargin: 1.0,
    });
    expect(insight.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  // REQ-MLR-050: the insight is regime-agnostic — there is no LEGAL_FIXED path and no
  // legal-metrology input; a healthy history yields a real STABLE recommendation (a legal
  // instrument is no longer silenced — its verification periodicity is a separate track).
  it("yields a STABLE recommendation regardless of regime (no LEGAL_FIXED)", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row(
        `2020-${String(i + 1).padStart(2, "0")}-01T00:00:00.000Z`,
        "CONFORMING",
        [0.5],
      ),
    );
    const insight = buildIntervalInsight({
      rows,
      currentIntervalMonths: 12,
      config: { targetReliability: 0.85 },
    });
    expect(insight.classification).toBe("STABLE");
    expect(insight.recommendation).not.toBeNull();
  });

  // REQ-ENGINE-002/INSIGHT: UNKNOWN cycles drop out of R but still appear in the series.
  it("excludes UNKNOWN from reliability but keeps it in the trend", () => {
    const rows = [
      row("2024-01-01T00:00:00.000Z", "CONFORMING", [0.5]),
      row("2024-07-01T00:00:00.000Z", "UNKNOWN", null),
      row("2025-01-01T00:00:00.000Z", "CONFORMING", [0.5]),
    ];
    const insight = buildIntervalInsight({
      rows,
      currentIntervalMonths: null,
    });
    expect(insight.reliability).toBe(1); // 2 of 2 KNOWN conforming
    expect(insight.coverage).toBeCloseTo(2 / 3, 10);
    expect(insight.series).toHaveLength(3);
    expect(insight.series[1]?.minMargin).toBeNull();
  });

  it("returns INSUFFICIENT_DATA below the cycle floor", () => {
    const insight = buildIntervalInsight({
      rows: [row("2024-01-01T00:00:00.000Z", "CONFORMING", [0.5])],
      currentIntervalMonths: null,
    });
    expect(insight.classification).toBe("INSUFFICIENT_DATA");
    expect(insight.recommendation).toBeNull();
  });
});

describe("buildFamilyStats", () => {
  it("aggregates KNOWN cycles + the mean inter-cal interval (UNKNOWN excluded)", () => {
    const stats = buildFamilyStats([
      {
        assetId: 1,
        approvedAt: new Date("2024-01-01T00:00:00Z"),
        asFoundConformity: "CONFORMING",
      },
      {
        assetId: 1,
        approvedAt: new Date("2025-01-01T00:00:00Z"),
        asFoundConformity: "CONFORMING",
      },
      {
        assetId: 2,
        approvedAt: new Date("2024-01-01T00:00:00Z"),
        asFoundConformity: "NON_CONFORMING",
      },
      {
        assetId: 3,
        approvedAt: new Date("2024-01-01T00:00:00Z"),
        asFoundConformity: "UNKNOWN",
      },
    ]);
    expect(stats?.populationN).toBe(3); // 2 conforming + 1 non-conforming; UNKNOWN dropped
    expect(stats?.conformingS).toBe(2);
    expect(stats?.meanTimeSinceCalMonths).toBeCloseTo(12, 0); // asset 1: ~12 months apart
  });

  it("returns null when there is no KNOWN cycle", () => {
    expect(
      buildFamilyStats([
        {
          assetId: 1,
          approvedAt: new Date("2024-01-01T00:00:00Z"),
          asFoundConformity: "UNKNOWN",
        },
      ]),
    ).toBeNull();
  });
});

describe("buildIntervalInsight with family (REQ-ENGINE-FAMILY-001)", () => {
  it("borrows from the family (M5_family) when single-unit history is thin", () => {
    const familyRows = Array.from({ length: 12 }, (_, i) => ({
      assetId: 10 + (i % 4),
      approvedAt: new Date(
        `2024-${String((i % 12) + 1).padStart(2, "0")}-01T00:00:00Z`,
      ),
      asFoundConformity: "CONFORMING" as const,
    }));
    const insight = buildIntervalInsight({
      rows: [row("2025-01-01T00:00:00.000Z", "CONFORMING", [0.5])], // 1 known < 3
      currentIntervalMonths: 12,
      familyRows,
    });
    expect(insight.classification).toBe("STABLE");
    expect(insight.recommendation?.method).toBe("M5_family");
  });
});
