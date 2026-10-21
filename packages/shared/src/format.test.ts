import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  formatCalendarDate,
  formatInstant,
  formatLocalDay,
  formatMoney,
  formatMoneyBRL,
  formatNumber,
  formatPercent,
  formatPercentPoints,
  pluralize,
} from "./format";

// Intl puts a non-breaking space between the currency symbol and the amount.
const NBSP = " ";

// The functions must give the same text whatever zone the process runs in: a
// Brazilian browser, a server on UTC, a traveller's laptop. Node re-reads
// process.env.TZ on assignment, so one suite covers all of them.
const ZONES = [
  "UTC",
  "America/Sao_Paulo",
  "Asia/Tokyo",
  "America/Los_Angeles",
] as const;

describe.each(ZONES)("formatting layer under TZ=%s", (zone) => {
  const originalZone = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = zone;
  });
  afterEach(() => {
    if (originalZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalZone;
  });

  it("REQ-FMT-4: the process really runs in the zone under test", () => {
    const offsetMinutes = new Date("2026-10-02T12:00:00Z").getTimezoneOffset();
    const expected = {
      UTC: 0,
      "America/Sao_Paulo": 180,
      "Asia/Tokyo": -540,
      "America/Los_Angeles": 420,
    }[zone];
    expect(offsetMinutes).toBe(expected);
  });

  describe("formatInstant (REQ-FMT-1)", () => {
    const afternoon = new Date("2026-10-02T17:30:00Z"); // 14:30 in Sao Paulo

    it("REQ-FMT-1: date, date-time and time read in America/Sao_Paulo", () => {
      expect(formatInstant(afternoon, "date")).toBe("02/10/2026");
      expect(formatInstant(afternoon, "date-time")).toBe("02/10/2026, 14:30");
      expect(formatInstant(afternoon, "time")).toBe("14:30");
    });

    it("REQ-FMT-1: defaults to the date style", () => {
      expect(formatInstant(afternoon)).toBe("02/10/2026");
    });

    it("REQ-FMT-1: month-name styles are pt-BR", () => {
      expect(formatInstant(afternoon, "date-medium")).toBe(
        "02 de out. de 2026",
      );
      expect(formatInstant(afternoon, "date-medium-natural")).toBe(
        "2 de out. de 2026",
      );
      expect(formatInstant(afternoon, "date-long")).toBe(
        "02 de outubro de 2026",
      );
      expect(formatInstant(afternoon, "date-time-medium")).toBe(
        "02 de out. de 2026, 14:30",
      );
      expect(formatInstant(afternoon, "day-month")).toBe("02 de out.");
      expect(formatInstant(afternoon, "month-year")).toBe("outubro de 2026");
    });

    it("REQ-FMT-4: 21:00-24:00 in Sao Paulo is still that day, not the UTC day", () => {
      // 21:00 on the 2nd in Sao Paulo is already 00:00Z on the 3rd.
      expect(formatInstant("2026-10-03T00:00:00.000Z", "date")).toBe(
        "02/10/2026",
      );
      expect(formatInstant("2026-10-03T00:00:00.000Z", "date-time")).toBe(
        "02/10/2026, 21:00",
      );
      expect(formatInstant("2026-10-03T01:30:00.000Z", "time")).toBe("22:30");
      // The last millisecond of the lab day.
      expect(formatInstant("2026-10-03T02:59:59.999Z", "date-time")).toBe(
        "02/10/2026, 23:59",
      );
      // The next lab day begins at 03:00Z.
      expect(formatInstant("2026-10-03T03:00:00.000Z", "date-time")).toBe(
        "03/10/2026, 00:00",
      );
      // Just before 21:00 the UTC and lab days agree.
      expect(formatInstant("2026-10-02T23:59:59.999Z", "date")).toBe(
        "02/10/2026",
      );
    });

    it("REQ-FMT-1: accepts Date, ISO string and epoch milliseconds", () => {
      const iso = "2026-10-02T17:30:00.000Z";
      expect(formatInstant(iso, "date-time")).toBe("02/10/2026, 14:30");
      expect(formatInstant(Date.parse(iso), "date-time")).toBe(
        "02/10/2026, 14:30",
      );
    });

    it("REQ-FMT-1: renders an em dash (or the given text) for absent or invalid values", () => {
      expect(formatInstant(null)).toBe("—");
      expect(formatInstant(undefined, "date-time")).toBe("—");
      expect(formatInstant("")).toBe("—");
      expect(formatInstant("not-a-date")).toBe("—");
      expect(formatInstant(new Date("nope"))).toBe("—");
      expect(formatInstant(null, "date", { empty: "Nunca" })).toBe("Nunca");
    });
  });

  describe("formatCalendarDate (REQ-FMT-1)", () => {
    it("REQ-FMT-1: an exact-UTC-midnight value names its UTC day", () => {
      // What a Postgres `date` column arrives as; read in Sao Paulo it would be
      // the evening of the 14th.
      expect(formatCalendarDate("2026-10-15T00:00:00.000Z")).toBe("15/10/2026");
      expect(formatCalendarDate(new Date("2026-10-15T00:00:00.000Z"))).toBe(
        "15/10/2026",
      );
      expect(formatCalendarDate("2026-10-15")).toBe("15/10/2026");
    });

    it("REQ-FMT-4: any other instant names its Sao Paulo day", () => {
      // Local noon (15:00Z) names the 15th.
      expect(formatCalendarDate("2026-10-15T15:00:00.000Z")).toBe("15/10/2026");
      // 22:30 on the 15th in Sao Paulo is 01:30Z on the 16th: still the 15th.
      expect(formatCalendarDate("2026-10-16T01:30:00.000Z")).toBe("15/10/2026");
      expect(formatCalendarDate("2026-10-16T02:59:59.999Z")).toBe("15/10/2026");
      // 00:00 on the 16th in Sao Paulo.
      expect(formatCalendarDate("2026-10-16T03:00:00.000Z")).toBe("16/10/2026");
      // One millisecond past UTC midnight is an instant, not a calendar date:
      // 21:00 on the 14th in Sao Paulo.
      expect(formatCalendarDate("2026-10-15T00:00:00.001Z")).toBe("14/10/2026");
    });

    it("REQ-FMT-1: month-name styles name the same day", () => {
      const value = "2026-10-15T00:00:00.000Z";
      expect(formatCalendarDate(value, "date-medium")).toBe(
        "15 de out. de 2026",
      );
      expect(formatCalendarDate(value, "date-long")).toBe(
        "15 de outubro de 2026",
      );
      expect(formatCalendarDate(value, "month-year")).toBe("outubro de 2026");
      expect(formatCalendarDate(value, "day-month")).toBe("15 de out.");
    });

    it("REQ-FMT-1: renders an em dash (or the given text) for absent or invalid values", () => {
      expect(formatCalendarDate(null)).toBe("—");
      expect(formatCalendarDate(undefined)).toBe("—");
      expect(formatCalendarDate("garbage")).toBe("—");
      expect(formatCalendarDate(null, "date", { empty: "Sem prazo" })).toBe(
        "Sem prazo",
      );
    });
  });

  describe("formatLocalDay (REQ-FMT-1)", () => {
    it("REQ-FMT-1: names the day a date picker built from local fields shows", () => {
      expect(formatLocalDay(new Date(2026, 9, 15))).toBe("15/10/2026");
      expect(formatLocalDay(new Date(2026, 9, 15, 23, 59))).toBe("15/10/2026");
      expect(formatLocalDay(new Date(2026, 9, 15), "month")).toBe("out.");
      expect(formatLocalDay(null)).toBe("—");
    });
  });

  describe("formatMoneyBRL (REQ-FMT-1)", () => {
    it("REQ-FMT-4: converts integer cents into reais", () => {
      expect(formatMoneyBRL(123456)).toBe(`R$${NBSP}1.234,56`);
      expect(formatMoneyBRL(1)).toBe(`R$${NBSP}0,01`);
      expect(formatMoneyBRL(100_000_000)).toBe(`R$${NBSP}1.000.000,00`);
    });

    it("REQ-FMT-4: zero and absent amounts are R$ 0,00", () => {
      expect(formatMoneyBRL(0)).toBe(`R$${NBSP}0,00`);
      expect(formatMoneyBRL(null)).toBe(`R$${NBSP}0,00`);
      expect(formatMoneyBRL(undefined)).toBe(`R$${NBSP}0,00`);
    });

    it("REQ-FMT-4: negative amounts lead with the minus sign", () => {
      expect(formatMoneyBRL(-50099)).toBe(`-R$${NBSP}500,99`);
      expect(formatMoneyBRL(-1)).toBe(`-R$${NBSP}0,01`);
    });

    it("REQ-FMT-4: fractional cents round to the nearest centavo", () => {
      expect(formatMoneyBRL(1234.4)).toBe(`R$${NBSP}12,34`);
      expect(formatMoneyBRL(1234.6)).toBe(`R$${NBSP}12,35`);
      expect(formatMoneyBRL(-1234.6)).toBe(`-R$${NBSP}12,35`);
    });

    it("REQ-FMT-1: an absent amount can render as given text", () => {
      expect(formatMoneyBRL(null, { empty: "—" })).toBe("—");
      expect(formatMoneyBRL(0, { empty: "—" })).toBe(`R$${NBSP}0,00`);
    });

    it("REQ-FMT-1: formatMoney keeps other currencies", () => {
      expect(formatMoney(123456)).toBe(`R$${NBSP}1.234,56`);
      expect(formatMoney(100, "USD")).toContain("1,00");
    });
  });

  describe("formatNumber (REQ-FMT-1)", () => {
    it("REQ-FMT-1: fixed decimals, pt-BR separators", () => {
      expect(formatNumber(1234.5, { decimals: 2 })).toBe("1.234,50");
      expect(formatNumber(0, { decimals: 2 })).toBe("0,00");
      expect(formatNumber(-1234.567, { decimals: 1 })).toBe("-1.234,6");
    });

    it("REQ-FMT-4: rounds half away from zero at the requested decimals", () => {
      expect(formatNumber(2.5, { decimals: 0 })).toBe("3");
      expect(formatNumber(-2.5, { decimals: 0 })).toBe("-3");
      expect(formatNumber(1.005, { decimals: 2 })).toBe("1,01");
    });

    it("REQ-FMT-1: without options keeps up to three decimals", () => {
      expect(formatNumber(1234.5678)).toBe("1.234,568");
      expect(formatNumber(1234)).toBe("1.234");
    });

    it("REQ-FMT-1: min/max decimals and grouping", () => {
      expect(formatNumber(12.3456, { maxDecimals: 1 })).toBe("12,3");
      expect(formatNumber(12, { maxDecimals: 1 })).toBe("12");
      expect(formatNumber(1, { minDecimals: 2 })).toBe("1,00");
      expect(formatNumber(1234.5, { decimals: 2, grouping: false })).toBe(
        "1234,50",
      );
    });

    it("REQ-FMT-1: absent or non-finite values render as an em dash", () => {
      expect(formatNumber(null)).toBe("—");
      expect(formatNumber(undefined)).toBe("—");
      expect(formatNumber(Number.NaN)).toBe("—");
      expect(formatNumber(Number.POSITIVE_INFINITY)).toBe("—");
      expect(formatNumber(null, { empty: "n/d" })).toBe("n/d");
    });
  });

  describe("formatPercent (REQ-FMT-1)", () => {
    it("REQ-FMT-1: a fraction as a percentage", () => {
      expect(formatPercent(0.255, { decimals: 1 })).toBe("25,5%");
      expect(formatPercent(1)).toBe("100%");
      expect(formatPercent(0, { minDecimals: 0, maxDecimals: 1 })).toBe("0%");
      expect(formatPercent(0.123, { minDecimals: 0, maxDecimals: 1 })).toBe(
        "12,3%",
      );
      expect(formatPercent(-0.05, { decimals: 0 })).toBe("-5%");
    });

    it("REQ-FMT-1: a value already in percent points", () => {
      expect(formatPercentPoints(12.34, { maxDecimals: 1 })).toBe("12,3%");
      expect(formatPercentPoints(20)).toBe("20%");
      expect(formatPercentPoints(0, { decimals: 1 })).toBe("0,0%");
    });

    it("REQ-FMT-1: absent values render as an em dash", () => {
      expect(formatPercent(null)).toBe("—");
      expect(formatPercentPoints(undefined)).toBe("—");
    });
  });
});

describe("pluralize", () => {
  it("selects singular and plural forms", () => {
    expect(pluralize(1, "ativo", "ativos")).toBe("1 ativo");
    expect(pluralize(3, "ativo", "ativos")).toBe("3 ativos");
    expect(pluralize(0, "ativo", "ativos")).toBe("0 ativos");
  });
});
