import { describe, expect, it } from "vitest";

import {
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
      subjectToLegalMetrology: false,
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

  // REQ-ENGINE-INSIGHT-002: legal-metrology → LEGAL_FIXED, no suggestion.
  it("returns LEGAL_FIXED with no recommendation for legal-metrology assets", () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      row(`2024-0${i + 1}-01T00:00:00.000Z`, "CONFORMING", [0.5]),
    );
    const insight = buildIntervalInsight({
      rows,
      currentIntervalMonths: 12,
      subjectToLegalMetrology: true,
    });
    expect(insight.classification).toBe("LEGAL_FIXED");
    expect(insight.recommendation).toBeNull();
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
      subjectToLegalMetrology: false,
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
      subjectToLegalMetrology: false,
    });
    expect(insight.classification).toBe("INSUFFICIENT_DATA");
    expect(insight.recommendation).toBeNull();
  });
});
