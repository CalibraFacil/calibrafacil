import { describe, expect, it } from "vitest";

import {
  dateInputToNoonIso,
  dateOnlyDaysBetween,
  instantToDateInputValue,
} from "./date-only";

describe("portal date-only helpers (REQ-DATE-007)", () => {
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
