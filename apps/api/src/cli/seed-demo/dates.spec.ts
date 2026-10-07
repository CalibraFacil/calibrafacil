import { describe, expect, it } from "vitest";

import {
  isLabWeekday,
  labMonthStart,
  labTimeOnDay,
  spreadApprovals,
  spreadRejections,
  toWorkingTime,
} from "./dates";
import { createRng } from "./prng";

const SPEC = {
  total: 128,
  inLast30Days: 100,
  minThisMonth: 12,
  windowDays: 90,
};

// A Wednesday in the middle of a month, a Monday morning, and the 1st (a Sunday).
const MIDWEEK = new Date("2026-10-14T18:00:00.000Z");
const MONDAY_MORNING = new Date("2026-10-12T12:00:00.000Z");
const FIRST_OF_MONTH = new Date("2026-02-01T15:00:00.000Z");

describe("spreadApprovals", () => {
  it("places exactly the requested number, oldest first, none in the future", () => {
    for (const now of [MIDWEEK, MONDAY_MORNING, FIRST_OF_MONTH]) {
      const dates = spreadApprovals(now, SPEC, createRng("dates"));
      expect(dates).toHaveLength(SPEC.total);
      expect(dates.every((date) => date.getTime() < now.getTime())).toBe(true);
      expect(dates.toSorted((a, b) => a.getTime() - b.getTime())).toEqual(
        dates,
      );
    }
  });

  it("stays inside the window", () => {
    const dates = spreadApprovals(MIDWEEK, SPEC, createRng("window"));
    const floor = MIDWEEK.getTime() - 91 * 86_400_000;
    expect(dates.every((date) => date.getTime() >= floor)).toBe(true);
  });

  it("keeps most approvals in the last 30 days", () => {
    const dates = spreadApprovals(MIDWEEK, SPEC, createRng("recent"));
    const cutoff = MIDWEEK.getTime() - 30 * 86_400_000;
    expect(
      dates.filter((date) => date.getTime() >= cutoff).length,
    ).toBeGreaterThanOrEqual(95);
  });

  it("only uses working days when working days are available", () => {
    const dates = spreadApprovals(MIDWEEK, SPEC, createRng("weekdays"));
    expect(dates.every((date) => isLabWeekday(date))).toBe(true);
  });

  it("guarantees the current month a floor of approvals", () => {
    for (const now of [MIDWEEK, MONDAY_MORNING, FIRST_OF_MONTH]) {
      const monthStart = labMonthStart(now).getTime();
      const dates = spreadApprovals(now, SPEC, createRng("month"));
      expect(
        dates.filter((d) => d.getTime() >= monthStart).length,
      ).toBeGreaterThanOrEqual(SPEC.minThisMonth);
    }
  });

  it("is reproducible", () => {
    expect(spreadApprovals(MIDWEEK, SPEC, createRng("same"))).toEqual(
      spreadApprovals(MIDWEEK, SPEC, createRng("same")),
    );
  });
});

describe("spreadRejections", () => {
  it("returns three past decisions, two of them this month", () => {
    const dates = spreadRejections(MIDWEEK, createRng("rej"));
    expect(dates).toHaveLength(3);
    const monthStart = labMonthStart(MIDWEEK).getTime();
    expect(dates.filter((d) => d.getTime() >= monthStart)).toHaveLength(2);
    expect(dates.every((d) => d.getTime() < MIDWEEK.getTime())).toBe(true);
  });
});

describe("toWorkingTime", () => {
  it("never moves an instant forward", () => {
    const rng = createRng("tw");
    for (let i = 0; i < 200; i += 1) {
      const date = new Date(MIDWEEK.getTime() - rng.int(0, 20 * 86_400_000));
      expect(toWorkingTime(date).getTime()).toBeLessThanOrEqual(date.getTime());
    }
  });

  it("moves a Saturday back to a weekday", () => {
    expect(
      isLabWeekday(toWorkingTime(new Date("2026-10-10T15:00:00.000Z"))),
    ).toBe(true);
  });
});

describe("labTimeOnDay", () => {
  it("builds a due date at a fixed lab hour", () => {
    // 12:00 on the lab clock (UTC-3) is 15:00 UTC.
    expect(labTimeOnDay(MIDWEEK, 2, 12).toISOString()).toBe(
      "2026-10-16T15:00:00.000Z",
    );
  });
});
