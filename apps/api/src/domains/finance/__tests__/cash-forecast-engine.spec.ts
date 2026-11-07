import { describe, expect, it } from "vitest";

import { bucketByDueDate, summarizeCashForecast } from "../cash-forecast";

const NOW = new Date("2026-05-27T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * DAY_MS);
}

describe("bucketByDueDate", () => {
  it("places past-due installments in OVERDUE", () => {
    const result = bucketByDueDate(
      [{ amountCents: 1_000, dueDate: daysFromNow(-2) }],
      NOW,
    );
    expect(result.OVERDUE.length).toBe(1);
    expect(result.THIS_WEEK.length).toBe(0);
  });

  it("bins by rolling-from-today boundaries", () => {
    const result = bucketByDueDate(
      [
        { amountCents: 10, dueDate: daysFromNow(3) }, // THIS_WEEK
        { amountCents: 20, dueDate: daysFromNow(10) }, // NEXT_WEEK
        { amountCents: 30, dueDate: daysFromNow(20) }, // IN_30_DAYS
        { amountCents: 40, dueDate: daysFromNow(45) }, // IN_60_DAYS
        { amountCents: 50, dueDate: daysFromNow(75) }, // IN_90_DAYS
        { amountCents: 60, dueDate: daysFromNow(120) }, // out of window
      ],
      NOW,
    );
    expect(result.THIS_WEEK.map((r) => r.amountCents)).toEqual([10]);
    expect(result.NEXT_WEEK.map((r) => r.amountCents)).toEqual([20]);
    expect(result.IN_30_DAYS.map((r) => r.amountCents)).toEqual([30]);
    expect(result.IN_60_DAYS.map((r) => r.amountCents)).toEqual([40]);
    expect(result.IN_90_DAYS.map((r) => r.amountCents)).toEqual([50]);
  });
});

describe("summarizeCashForecast", () => {
  it("returns zeros when there are no installments and no recurring", () => {
    const summary = summarizeCashForecast({
      installments: [],
      recurringMonthlyCents: 0,
      now: NOW,
    });
    expect(summary.totals).toEqual({
      confirmedCents: 0,
      projectedCents: 0,
      overdueCents: 0,
    });
    for (const bucket of Object.values(summary.buckets)) {
      expect(bucket).toEqual({
        confirmedCents: 0,
        projectedCents: 0,
        confirmedCount: 0,
      });
    }
  });

  it("aggregates confirmed cents + count per bucket", () => {
    const summary = summarizeCashForecast({
      installments: [
        { amountCents: 30_000, dueDate: daysFromNow(2) },
        { amountCents: 70_000, dueDate: daysFromNow(2) },
        { amountCents: 40_000, dueDate: daysFromNow(45) },
      ],
      recurringMonthlyCents: 0,
      now: NOW,
    });
    expect(summary.buckets.THIS_WEEK).toEqual({
      confirmedCents: 100_000,
      projectedCents: 0,
      confirmedCount: 2,
    });
    expect(summary.buckets.IN_60_DAYS).toEqual({
      confirmedCents: 40_000,
      projectedCents: 0,
      confirmedCount: 1,
    });
    expect(summary.totals.confirmedCents).toBe(140_000);
  });

  it("allocates recurring monthly evenly across forward buckets", () => {
    const summary = summarizeCashForecast({
      installments: [],
      recurringMonthlyCents: 30_000,
      now: NOW,
    });
    expect(summary.buckets.OVERDUE.projectedCents).toBe(0);
    expect(summary.buckets.THIS_WEEK.projectedCents).toBeGreaterThan(0);
    expect(summary.totals.projectedCents).toBeGreaterThan(0);
  });

  it("surfaces overdue cents on totals.overdueCents", () => {
    const summary = summarizeCashForecast({
      installments: [{ amountCents: 50_000, dueDate: daysFromNow(-3) }],
      recurringMonthlyCents: 0,
      now: NOW,
    });
    expect(summary.totals.overdueCents).toBe(50_000);
    expect(summary.buckets.OVERDUE.confirmedCents).toBe(50_000);
  });
});
