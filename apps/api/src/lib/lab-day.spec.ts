import { describe, expect, it } from "vitest";
import { endOfLabDay, startOfLabDay } from "./lab-day";

// 23:30 in Sao Paulo on 2026-05-20 is 02:30Z on the 21st.
const EVENING = new Date("2026-05-20T23:30:00-03:00");

describe("laboratory day bounds (REQ-DATE-009)", () => {
  it("starts the day at midnight Sao Paulo, not midnight UTC", () => {
    expect(startOfLabDay(EVENING).toISOString()).toBe(
      "2026-05-20T03:00:00.000Z",
    );
    expect(
      startOfLabDay(new Date("2026-05-20T03:00:00.000Z")).toISOString(),
    ).toBe("2026-05-20T03:00:00.000Z");
    expect(
      startOfLabDay(new Date("2026-05-20T02:59:59.999Z")).toISOString(),
    ).toBe("2026-05-19T03:00:00.000Z");
  });

  it("ends the day one millisecond before the next midnight Sao Paulo", () => {
    expect(endOfLabDay(EVENING).toISOString()).toBe("2026-05-21T02:59:59.999Z");
    // Due at 22:00 in Sao Paulo today is still "due today" at 23:30.
    expect(new Date("2026-05-21T01:00:00.000Z") <= endOfLabDay(EVENING)).toBe(
      true,
    );
    expect(new Date("2026-05-21T03:00:00.000Z") <= endOfLabDay(EVENING)).toBe(
      false,
    );
  });
});
