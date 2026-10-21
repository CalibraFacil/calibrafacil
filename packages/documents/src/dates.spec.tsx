import {
  calendarDateKey,
  labCalendarDayKey,
} from "@calibra-facil/shared/calendar-date";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  formatCalendarDate,
  formatDateOnly,
  formatDateOnlyKey,
  getDateOnlyDay,
  formatLabDate,
  formatLabDateTime,
  getLabCalendarDay,
  formatLabDayKey,
  startOfLabMonth,
} from "./dates.js";
import { LabelHtml } from "./LabelHtml.js";

// 01:30 UTC on 3 October is still 22:30 on 2 October at the laboratory.
const LATE_EVENING = "2026-10-03T01:30:00.000Z";

describe("document dates", () => {
  it("shows a moment in the laboratory's time zone", () => {
    expect(formatLabDateTime(LATE_EVENING)).toBe("02/10/2026, 22:30");
    expect(formatLabDate(new Date(LATE_EVENING))).toBe("02/10/2026");
  });

  it("keeps a calendar date stored at UTC midnight on its own day", () => {
    const calibrationDate = "2026-10-15T00:00:00.000Z";

    expect(formatCalendarDate(calibrationDate)).toBe("15/10/2026");
    // Read as a moment it would move back a day.
    expect(formatLabDate(calibrationDate)).toBe("14/10/2026");
  });

  it("falls back for a missing or invalid value", () => {
    expect(formatLabDate(null)).toBe("—");
    expect(formatLabDateTime(undefined, "-")).toBe("-");
    expect(formatCalendarDate("not a date")).toBe("—");
  });

  it("names the laboratory's calendar day of a moment, whatever the server's zone", () => {
    // 01:30 UTC on 1 January is 22:30 on 31 December in São Paulo.
    expect(getLabCalendarDay(new Date("2026-01-01T01:30:00.000Z"))).toEqual({
      year: 2025,
      month: 12,
      day: 31,
    });
    expect(getLabCalendarDay(new Date("2026-01-01T03:00:00.000Z"))).toEqual({
      year: 2026,
      month: 1,
      day: 1,
    });
  });

  describe("date-only values", () => {
    it("reads exact UTC midnight as the day it names, and any other instant in the laboratory's zone", () => {
      // A date typed into a date field and stored at UTC midnight.
      expect(formatDateOnly("2026-10-15T00:00:00.000Z")).toBe("15/10/2026");
      // The same field after a storage change to local noon (15:00Z).
      expect(formatDateOnly("2026-10-15T15:00:00.000Z")).toBe("15/10/2026");
      // A real moment: 01:30Z on the 16th is the evening of the 15th in Brazil.
      expect(formatDateOnly("2026-10-16T01:30:00.000Z")).toBe("15/10/2026");
      expect(formatDateOnlyKey(new Date("2026-10-15T00:00:00.000Z"))).toBe(
        "2026-10-15",
      );
      expect(getDateOnlyDay(new Date("2026-01-01T00:00:00.000Z"))).toEqual({
        year: 2026,
        month: 1,
        day: 1,
      });
    });

    it("formats in the requested shape and falls back for a missing value", () => {
      expect(
        formatDateOnly("2026-10-15T00:00:00.000Z", "—", {
          day: "2-digit",
          month: "long",
          year: "numeric",
        }),
      ).toBe("15 de outubro de 2026");
      expect(formatDateOnly(null)).toBe("—");
      expect(formatDateOnly("nope", "Sem data")).toBe("Sem data");
    });
  });

  it("prints a label with the day the calibration was performed at the lab", () => {
    const html = renderToStaticMarkup(
      <LabelHtml
        label={{
          jobId: "CAL-2026-0001",
          labName: "Laboratório",
          assetTag: "BAL-07",
          calibrationDate: LATE_EVENING,
          qrCodeDataUrl: "data:image/png;base64,",
        }}
      />,
    );

    expect(html).toContain("02/10/2026");
    expect(html).not.toContain("03/10/2026");
  });

  it("names the laboratory's calendar day of a moment as YYYY-MM-DD", () => {
    expect(formatLabDayKey(new Date(LATE_EVENING))).toBe("2026-10-02");
    expect(formatLabDayKey(new Date("2026-10-03T03:00:00.000Z"))).toBe(
      "2026-10-03",
    );
  });

  it("starts the month at midnight in the laboratory, not at UTC midnight", () => {
    // 01:30 UTC on 1 June is still 22:30 on 31 May at the laboratory: May.
    expect(startOfLabMonth(new Date("2026-06-01T01:30:00.000Z"))).toEqual(
      new Date("2026-05-01T03:00:00.000Z"),
    );
    expect(startOfLabMonth(new Date("2026-05-20T15:00:00.000Z"))).toEqual(
      new Date("2026-05-01T03:00:00.000Z"),
    );
  });
});

// REQ-CAL-001: the `calendarDate` column type (packages/db) cannot import this
// package, so it uses the copy of the rule in @calibra-facil/shared. This pins
// the two to the same answer.
describe("calendar-date rule parity with @calibra-facil/shared", () => {
  const TIMES = [
    "T00:00:00.000Z",
    "T00:00:00.001Z",
    "T01:30:00.000Z",
    "T02:59:59.999Z",
    "T03:00:00.000Z",
    "T15:00:00.000Z",
    "T23:59:59.000Z",
  ];
  // DST-free years, plus 2017-2018 when Sao Paulo still observed summer time
  // (UTC-2 from the 3rd Sunday of October to the 3rd Sunday of February).
  const DAYS = [
    "2016-12-31",
    "2017-10-14",
    "2017-10-15",
    "2017-10-16",
    "2018-01-10",
    "2018-02-17",
    "2018-02-18",
    "2018-02-19",
    "2018-11-03",
    "2018-11-04",
    "2019-02-16",
    "2019-02-17",
    "2020-02-29",
    "2026-10-15",
    "2027-12-31",
  ];

  it("names the same day as formatDateOnlyKey over edge instants", () => {
    for (const day of DAYS) {
      for (const time of TIMES) {
        const instant = new Date(`${day}${time}`);
        expect(calendarDateKey(instant), `${day}${time}`).toBe(
          formatDateOnlyKey(instant),
        );
        expect(labCalendarDayKey(instant), `${day}${time}`).toBe(
          formatLabDayKey(instant),
        );
      }
    }
  });
});
