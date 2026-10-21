import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  addLabBusinessDays,
  calendarDateFromKey,
  calendarDateKey,
  calendarDaysBetween,
  isCalendarDatePast,
  labCalendarDayKey,
  labDaysSince,
  labDaysUntil,
  labToday,
} from "./calendar-date";

describe("addLabBusinessDays: a turnaround counted on the laboratory's calendar (REQ-CAL-003)", () => {
  it("starts from the laboratory's day, not the UTC one, at 23:30 on a Thursday", () => {
    // 2026-10-15 is a Thursday. 23:30 in Sao Paulo is 02:30Z on Friday the
    // 16th: counting from the UTC Friday skipped the weekend to Monday.
    const thursdayEvening = new Date("2026-10-16T02:30:00.000Z");
    expect(addLabBusinessDays(thursdayEvening, 1).toISOString()).toBe(
      "2026-10-16T00:00:00.000Z",
    );
    expect(addLabBusinessDays(thursdayEvening, 2).toISOString()).toBe(
      "2026-10-19T00:00:00.000Z",
    );
  });

  it("skips weekends and returns the due day as a calendar date", () => {
    const fridayNoon = new Date("2026-10-16T15:00:00.000Z");
    expect(addLabBusinessDays(fridayNoon, 1).toISOString()).toBe(
      "2026-10-19T00:00:00.000Z",
    );
    expect(addLabBusinessDays(fridayNoon, 0).toISOString()).toBe(
      "2026-10-16T00:00:00.000Z",
    );
  });
});

describe("labDaysSince: the laboratory days since an instant (REQ-CAL-003)", () => {
  it("counts the day an instant fell on in Sao Paulo, not in UTC", () => {
    // 22:00 on the 14th in Sao Paulo is 01:00Z on the 15th.
    const evening = new Date("2026-10-15T01:00:00.000Z");
    expect(labDaysSince(evening, new Date("2026-10-15T15:00:00.000Z"))).toBe(1);
    // Still the same laboratory day at 23:30.
    expect(labDaysSince(evening, new Date("2026-10-15T02:30:00.000Z"))).toBe(0);
    // An instant at exactly UTC midnight is an instant: 21:00 the day before.
    expect(
      labDaysSince(
        new Date("2026-10-15T00:00:00.000Z"),
        new Date("2026-10-16T15:00:00.000Z"),
      ),
    ).toBe(2);
  });
});

describe("overdue and expiry are judged by laboratory days (REQ-CAL-003)", () => {
  const due = new Date("2026-10-15T00:00:00.000Z"); // a stored calendar date

  it("is not past on the day itself, including 21:00-24:00 in Sao Paulo", () => {
    // 23:30 on 2026-10-15 in Sao Paulo is 02:30Z on the 16th: the UTC day has
    // rolled over, the laboratory's has not.
    const lateEvening = new Date("2026-10-16T02:30:00.000Z");
    expect(isCalendarDatePast(due, lateEvening)).toBe(false);
    expect(labDaysUntil(due, lateEvening)).toBe(0);
    // 21:30 on the 14th is 00:30Z on the 15th: one day to go in the laboratory.
    expect(isCalendarDatePast(due, new Date("2026-10-15T00:30:00.000Z"))).toBe(
      false,
    );
    expect(labDaysUntil(due, new Date("2026-10-15T00:30:00.000Z"))).toBe(1);
  });

  it("is past from 00:00 of the next day in Sao Paulo", () => {
    const justAfterMidnight = new Date("2026-10-16T03:10:00.000Z"); // 00:10 on the 16th
    expect(isCalendarDatePast(due, justAfterMidnight)).toBe(true);
    expect(labDaysUntil(due, justAfterMidnight)).toBe(-1);
  });

  it("reads a value stored at local noon by the day it names", () => {
    const noon = new Date("2026-10-15T15:00:00.000Z");
    expect(isCalendarDatePast(noon, new Date("2026-10-16T02:30:00.000Z"))).toBe(
      false,
    );
    expect(isCalendarDatePast(noon, new Date("2026-10-16T03:10:00.000Z"))).toBe(
      true,
    );
  });
});

describe("calendar dates (REQ-CAL-001, REQ-CAL-003)", () => {
  it("names the UTC day of an exact-UTC-midnight value", () => {
    expect(calendarDateKey(new Date("2026-10-15T00:00:00.000Z"))).toBe(
      "2026-10-15",
    );
  });

  it("names the Sao Paulo day of any other instant", () => {
    // 02:59Z is 23:59 of the previous day in Sao Paulo (UTC-3, no DST since 2019).
    expect(calendarDateKey(new Date("2026-10-15T02:59:59.999Z"))).toBe(
      "2026-10-14",
    );
    expect(calendarDateKey(new Date("2026-10-15T03:00:00.000Z"))).toBe(
      "2026-10-15",
    );
    expect(calendarDateKey(new Date("2026-10-15T15:00:00.000Z"))).toBe(
      "2026-10-15",
    );
    expect(calendarDateKey(new Date("2026-10-15T23:59:59.000Z"))).toBe(
      "2026-10-15",
    );
    // 01:30Z is 22:30 of the previous Sao Paulo day.
    expect(calendarDateKey(new Date("2026-10-15T01:30:00.000Z"))).toBe(
      "2026-10-14",
    );
  });

  it("uses the DST offset (UTC-2) of a pre-2019 summer date", () => {
    // 2018-01-10: Sao Paulo observed DST (UTC-2), so 02:30Z is 00:30 the same day.
    expect(calendarDateKey(new Date("2018-01-10T02:30:00.000Z"))).toBe(
      "2018-01-10",
    );
    expect(calendarDateKey(new Date("2018-01-10T01:59:00.000Z"))).toBe(
      "2018-01-09",
    );
  });

  it("builds the in-memory form (UTC midnight) from a day key or ISO string", () => {
    expect(calendarDateFromKey("2026-10-15")?.toISOString()).toBe(
      "2026-10-15T00:00:00.000Z",
    );
    expect(calendarDateFromKey("2026-10-15T15:00:00.000Z")?.toISOString()).toBe(
      "2026-10-15T00:00:00.000Z",
    );
    expect(calendarDateFromKey("2026-02-30")).toBeNull();
    expect(calendarDateFromKey("not a date")).toBeNull();
  });

  it("labToday is the Sao Paulo day, not the UTC day, at 21:00-24:00 local", () => {
    // 2026-10-16T01:00Z is 22:00 of 2026-10-15 in Sao Paulo.
    expect(labCalendarDayKey(new Date("2026-10-16T01:00:00.000Z"))).toBe(
      "2026-10-15",
    );
    expect(labToday(new Date("2026-10-16T01:00:00.000Z")).toISOString()).toBe(
      "2026-10-15T00:00:00.000Z",
    );
    expect(labToday(new Date("2026-10-16T03:00:00.000Z")).toISOString()).toBe(
      "2026-10-16T00:00:00.000Z",
    );
  });

  it("adds days and counts days between calendar dates across month ends", () => {
    const day = new Date("2026-02-27T15:00:00.000Z");
    expect(addCalendarDays(day, 3).toISOString()).toBe(
      "2026-03-02T00:00:00.000Z",
    );
    expect(addCalendarDays(day, -27).toISOString()).toBe(
      "2026-01-31T00:00:00.000Z",
    );
    expect(
      calendarDaysBetween(
        new Date("2026-10-15T00:00:00.000Z"),
        new Date("2026-10-22T15:00:00.000Z"),
      ),
    ).toBe(7);
    expect(
      calendarDaysBetween(
        new Date("2026-10-15T00:00:00.000Z"),
        new Date("2026-10-14T15:00:00.000Z"),
      ),
    ).toBe(-1);
  });
});
