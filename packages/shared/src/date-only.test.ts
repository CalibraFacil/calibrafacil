import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  dateInputToNoonIso,
  dateOnlyDaysBetween,
  dateOnlyToInputValue,
  instantToDateInputValue,
  labDaysBetween,
  todayDateInputValue,
} from "./calendar-date";

// 23:30 in Sao Paulo on 2026-05-20 is already 02:30Z on 2026-05-21.
const EVENING = new Date("2026-05-20T23:30:00-03:00");
// Pin the lab's zone (a developer's laptop or CI can sit anywhere); tests that
// simulate a browser elsewhere put it back.
beforeAll(() => {
  process.env.TZ = "America/Sao_Paulo";
});
afterEach(() => {
  process.env.TZ = "America/Sao_Paulo";
});

describe("todayDateInputValue", () => {
  it("REQ-DATE-001: is the Sao Paulo day late in the evening, not the UTC day", () => {
    expect(EVENING.toISOString()).toBe("2026-05-21T02:30:00.000Z");
    expect(todayDateInputValue(EVENING)).toBe("2026-05-20");
    // The old `toISOString().slice(0, 10)` answered 2026-05-21.
    expect(EVENING.toISOString().slice(0, 10)).not.toBe(
      todayDateInputValue(EVENING),
    );
  });

  it("REQ-DATE-001: does not depend on the browser zone", () => {
    process.env.TZ = "UTC";
    expect(todayDateInputValue(EVENING)).toBe("2026-05-20");
    process.env.TZ = "Asia/Tokyo";
    expect(todayDateInputValue(EVENING)).toBe("2026-05-20");
  });
});

describe("dateInputToNoonIso", () => {
  it("REQ-DATE-002: keeps the typed day when read back as a local date", () => {
    const iso = dateInputToNoonIso("2026-05-20");
    expect(iso).toBe("2026-05-20T15:00:00.000Z");
    expect(instantToDateInputValue(iso)).toBe("2026-05-20");
    // `new Date("2026-05-20")` is UTC midnight: the 19th for a Brazilian user.
    expect(instantToDateInputValue(new Date("2026-05-20").toISOString())).toBe(
      "2026-05-19",
    );
  });

  it("REQ-DATE-002: rejects partial and impossible days", () => {
    expect(dateInputToNoonIso("")).toBeNull();
    expect(dateInputToNoonIso("2026-05")).toBeNull();
    expect(dateInputToNoonIso("2026-13-40")).toBeNull();
  });
});

describe("labDaysBetween", () => {
  it("REQ-DATE-003: counts laboratory days even when the browser is on UTC", () => {
    process.env.TZ = "UTC";
    const dueTomorrow = new Date("2026-05-21T12:00:00-03:00");
    expect(labDaysBetween(EVENING, dueTomorrow)).toBe(1);
    expect(labDaysBetween(EVENING, EVENING)).toBe(0);
    expect(labDaysBetween(EVENING, new Date("2026-05-19T12:00:00-03:00"))).toBe(
      -1,
    );
  });
});

describe("stored date-only values (REQ-DATE-007)", () => {
  // A date typed into a date field and stored at UTC midnight: 15/10 there is
  // the evening of 14/10 in Sao Paulo.
  const STORED = "2026-10-15T00:00:00.000Z";

  it("reads an exact-UTC-midnight value as the day it names", () => {
    expect(dateOnlyToInputValue(STORED)).toBe("2026-10-15");
    expect(dateOnlyToInputValue(new Date(STORED))).toBe("2026-10-15");
    // The browser-day reading the visit screens used gives the day before.
    expect(instantToDateInputValue(STORED)).toBe("2026-10-14");
  });

  it("reads a value stored at local noon, or a real moment, in the lab zone", () => {
    expect(dateOnlyToInputValue("2026-10-15T15:00:00.000Z")).toBe("2026-10-15");
    expect(dateOnlyToInputValue("2026-10-16T01:30:00.000Z")).toBe("2026-10-15");
  });

  it("is empty for a missing or unparseable value", () => {
    expect(dateOnlyToInputValue(null)).toBe("");
    expect(dateOnlyToInputValue(undefined)).toBe("");
    expect(dateOnlyToInputValue("nope")).toBe("");
  });

  it("counts days to a stored date from the laboratory day, evening included", () => {
    // 23:30 on 14/10 in Sao Paulo is already 15/10 in UTC.
    const evening = new Date("2026-10-14T23:30:00-03:00");
    expect(dateOnlyDaysBetween(evening, new Date(STORED))).toBe(1);
    expect(
      dateOnlyDaysBetween(
        new Date("2026-10-15T09:00:00-03:00"),
        new Date(STORED),
      ),
    ).toBe(0);
    expect(
      dateOnlyDaysBetween(
        new Date("2026-10-16T00:30:00-03:00"),
        new Date(STORED),
      ),
    ).toBe(-1);
  });
});

describe("instants and typed days for date inputs (REQ-DATE-007)", () => {
  it("reads an instant as the day the user sees, late in the evening too", () => {
    // 23:30 in Sao Paulo on 2026-05-20 is 02:30Z on the 21st.
    const evening = "2026-05-21T02:30:00.000Z";
    expect(evening.slice(0, 10)).toBe("2026-05-21");
    expect(instantToDateInputValue(evening)).toBe("2026-05-20");
  });

  it("returns an empty value for a missing or invalid instant", () => {
    expect(instantToDateInputValue(null)).toBe("");
    expect(instantToDateInputValue("not-a-date")).toBe("");
  });

  it("sends a typed day as noon so it does not slip to the day before", () => {
    const noon = dateInputToNoonIso("2026-05-20");
    expect(noon).toBe("2026-05-20T15:00:00.000Z");
    expect(instantToDateInputValue(noon)).toBe("2026-05-20");
    expect(instantToDateInputValue(new Date("2026-05-20").toISOString())).toBe(
      "2026-05-19",
    );
    expect(dateInputToNoonIso("")).toBeNull();
    expect(dateInputToNoonIso("2026-13-40")).toBeNull();
  });
});

describe("days to a stored date-only value (REQ-DATE-007)", () => {
  // 10/06 stored at UTC midnight is 21:00 on 09/06 in Sao Paulo.
  const due = new Date("2026-06-10T00:00:00.000Z");

  it("counts from the Sao Paulo day to the day that was typed", () => {
    expect(
      dateOnlyDaysBetween(new Date("2026-06-10T09:00:00-03:00"), due),
    ).toBe(0);
    expect(
      dateOnlyDaysBetween(new Date("2026-06-09T23:30:00-03:00"), due),
    ).toBe(1);
    expect(
      dateOnlyDaysBetween(new Date("2026-06-14T22:00:00-03:00"), due),
    ).toBe(-4);
  });
});
