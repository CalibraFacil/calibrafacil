import { describe, expect, it } from "vitest";

import {
  formatCalendarDate,
  formatInstant,
} from "@calibra-facil/shared/format";

describe("date-only formatting (REQ-DATE-007)", () => {
  // Typed in a date field and stored at UTC midnight: 21:00 the evening before
  // in Sao Paulo.
  const stored = "2026-06-10T00:00:00.000Z";

  it("shows a stored day on the day it names", () => {
    expect(formatCalendarDate(stored, "date-medium")).toBe(
      "10 de jun. de 2026",
    );
    expect(formatCalendarDate(stored, "date-long")).toBe("10 de junho de 2026");
    // The moment formatter moves it back a day, which is the bug.
    expect(formatInstant(stored, "date-medium")).toBe("09 de jun. de 2026");
  });

  it("keeps a day stored at local noon, and shows a real moment on the lab day", () => {
    expect(formatCalendarDate("2026-06-10T15:00:00.000Z", "date-medium")).toBe(
      "10 de jun. de 2026",
    );
    expect(formatCalendarDate("2026-06-11T02:30:00.000Z", "date-medium")).toBe(
      "10 de jun. de 2026",
    );
  });

  it("falls back to a dash", () => {
    expect(formatCalendarDate(null, "date-medium")).toBe("—");
    expect(formatCalendarDate("nope", "date-long")).toBe("—");
  });
});
