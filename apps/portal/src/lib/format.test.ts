import { describe, expect, it } from "vitest";

import { formatDate, formatDateOnly, formatDateOnlyLong } from "./format";

describe("date-only formatting (REQ-DATE-007)", () => {
  // Typed in a date field and stored at UTC midnight: 21:00 the evening before
  // in Sao Paulo.
  const stored = "2026-06-10T00:00:00.000Z";

  it("shows a stored day on the day it names", () => {
    expect(formatDateOnly(stored)).toBe("10 de jun. de 2026");
    expect(formatDateOnlyLong(stored)).toBe("10 de junho de 2026");
    // The moment formatter moves it back a day, which is the bug.
    expect(formatDate(stored)).toBe("09 de jun. de 2026");
  });

  it("keeps a day stored at local noon, and shows a real moment on the lab day", () => {
    expect(formatDateOnly("2026-06-10T15:00:00.000Z")).toBe(
      "10 de jun. de 2026",
    );
    expect(formatDateOnly("2026-06-11T02:30:00.000Z")).toBe(
      "10 de jun. de 2026",
    );
  });

  it("falls back to a dash", () => {
    expect(formatDateOnly(null)).toBe("—");
    expect(formatDateOnlyLong("nope")).toBe("—");
  });
});
