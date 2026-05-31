import { describe, expect, it } from "vitest";

import { summarizeFiscalTrend } from "../fiscal-trend";

describe("summarizeFiscalTrend", () => {
  it("returns empty list for no events", () => {
    expect(summarizeFiscalTrend([])).toEqual([]);
  });

  it("buckets by YYYY-MM and counts each kind", () => {
    const result = summarizeFiscalTrend([
      { occurredAt: "2026-03-05T00:00:00.000Z", kind: "issued" },
      { occurredAt: "2026-03-15T00:00:00.000Z", kind: "issued" },
      { occurredAt: "2026-03-20T00:00:00.000Z", kind: "rejected" },
      { occurredAt: "2026-04-02T00:00:00.000Z", kind: "cancelled" },
    ]);
    expect(result).toHaveLength(2);
    const march = result.find((r) => r.period === "2026-03");
    const april = result.find((r) => r.period === "2026-04");
    expect(march).toMatchObject({
      issued: 2,
      rejected: 1,
      cancelled: 0,
      total: 3,
    });
    expect(april).toMatchObject({
      issued: 0,
      rejected: 0,
      cancelled: 1,
      total: 1,
      rejectionRate: null,
    });
  });

  it("computes rejection rate over issued + rejected only", () => {
    const result = summarizeFiscalTrend([
      { occurredAt: "2026-05-01T00:00:00.000Z", kind: "issued" },
      { occurredAt: "2026-05-02T00:00:00.000Z", kind: "issued" },
      { occurredAt: "2026-05-03T00:00:00.000Z", kind: "issued" },
      { occurredAt: "2026-05-04T00:00:00.000Z", kind: "rejected" },
    ]);
    expect(result[0]?.rejectionRate).toBe(25);
  });

  it("ignores invalid occurredAt entries", () => {
    const result = summarizeFiscalTrend([
      { occurredAt: "not-a-date", kind: "issued" },
      { occurredAt: "2026-03-01T00:00:00.000Z", kind: "issued" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.issued).toBe(1);
  });

  it("sorts ascending by period", () => {
    const result = summarizeFiscalTrend([
      { occurredAt: "2026-06-01T00:00:00.000Z", kind: "issued" },
      { occurredAt: "2026-04-01T00:00:00.000Z", kind: "issued" },
      { occurredAt: "2026-05-01T00:00:00.000Z", kind: "issued" },
    ]);
    expect(result.map((r) => r.period)).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
  });
});
