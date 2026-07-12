import { describe, expect, it } from "vitest";

import { dayKey, groupDuesByDay, parseMonthParam, toMonthParam } from "./lib";
import type { CalendarDueAsset } from "./queries";

function due(overrides: Partial<CalendarDueAsset>): CalendarDueAsset {
  return {
    id: 1,
    publicId: "pub-1",
    name: "Balança",
    tag: "EQ-1",
    assetTypeName: "Balança",
    nextCalibrationDate: "2026-06-15T12:00:00.000Z",
    inLab: false,
    ...overrides,
  };
}

describe("groupDuesByDay", () => {
  it("buckets instruments by local calendar day", () => {
    const byDay = groupDuesByDay([
      due({ id: 1, nextCalibrationDate: "2026-06-15T12:00:00.000Z" }),
      due({ id: 2, nextCalibrationDate: "2026-06-15T13:00:00.000Z" }),
      due({ id: 3, nextCalibrationDate: "2026-06-20T12:00:00.000Z" }),
    ]);

    const key15 = dayKey(new Date("2026-06-15T12:00:00.000Z"));
    const key20 = dayKey(new Date("2026-06-20T12:00:00.000Z"));
    expect(byDay.get(key15)?.map((item) => item.id)).toEqual([1, 2]);
    expect(byDay.get(key20)?.map((item) => item.id)).toEqual([3]);
  });

  it("skips entries with unparseable dates", () => {
    const byDay = groupDuesByDay([due({ nextCalibrationDate: "not-a-date" })]);
    expect(byDay.size).toBe(0);
  });
});

describe("month param round-trip", () => {
  it("parses a valid YYYY-MM into the first of the month", () => {
    const parsed = parseMonthParam("2026-06");
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(5);
    expect(parsed?.getDate()).toBe(1);
    expect(toMonthParam(parsed ?? new Date())).toBe("2026-06");
  });

  it("rejects malformed values", () => {
    expect(parseMonthParam("2026-13")).toBeNull();
    expect(parseMonthParam("2026-6")).toBeNull();
    expect(parseMonthParam(undefined)).toBeNull();
    expect(parseMonthParam("junho")).toBeNull();
  });
});
