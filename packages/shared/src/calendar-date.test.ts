import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  calendarDateFromKey,
  calendarDateKey,
  calendarDaysBetween,
  labCalendarDayKey,
  labToday,
} from "./calendar-date";

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
