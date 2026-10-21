import { describe, expect, it } from "vitest";

import {
  assessStandardValidity,
  isStandardValidOn,
  standardDaysUntilExpiry,
} from "./index";

// A reference standard is valid THROUGH the calendar day its certificate names
// (next_calibration_date), judged on the Sao Paulo day the work was performed.
describe("isStandardValidOn (REQ-CAL-004)", () => {
  const validThrough = new Date("2026-10-15T00:00:00.000Z"); // stored calendar date

  it("accepts work performed on the last valid day, even at 23:30 in Sao Paulo", () => {
    // 23:30 on 2026-10-15 in Sao Paulo is 02:30Z on the 16th.
    expect(
      isStandardValidOn(validThrough, new Date("2026-10-16T02:30:00.000Z")),
    ).toBe(true);
    expect(
      isStandardValidOn(validThrough, new Date("2026-10-15T08:00:00.000Z")),
    ).toBe(true);
  });

  it("refuses work performed on the day after, from 00:00 in Sao Paulo", () => {
    // 00:10 on 2026-10-16 in Sao Paulo is 03:10Z.
    expect(
      isStandardValidOn(validThrough, new Date("2026-10-16T03:10:00.000Z")),
    ).toBe(false);
    expect(
      isStandardValidOn(validThrough, new Date("2026-10-17T15:00:00.000Z")),
    ).toBe(false);
  });

  it("accepts work performed before the last valid day", () => {
    expect(
      isStandardValidOn(validThrough, new Date("2026-10-01T12:00:00.000Z")),
    ).toBe(true);
  });

  it("reads the validity by the one day rule: UTC midnight is its UTC day, other instants their Sao Paulo day", () => {
    // Stored by older clients at local noon (15:00Z): still the 15th.
    const noon = new Date("2026-10-15T15:00:00.000Z");
    expect(isStandardValidOn(noon, new Date("2026-10-16T02:30:00.000Z"))).toBe(
      true,
    );
    expect(isStandardValidOn(noon, new Date("2026-10-16T03:10:00.000Z"))).toBe(
      false,
    );
  });

  it("accepts the ISO strings a desktop cache or a JSON snapshot carries", () => {
    expect(
      isStandardValidOn(
        "2026-10-15T00:00:00.000Z",
        new Date("2026-10-16T02:30:00.000Z"),
      ),
    ).toBe(true);
    expect(
      isStandardValidOn("2026-10-15", new Date("2026-10-16T03:10:00.000Z")),
    ).toBe(false);
  });

  it("counts laboratory days left, 0 on the last valid day and negative once expired", () => {
    const validThroughIso = "2026-10-15T00:00:00.000Z";
    // 23:30 on the 15th in Sao Paulo.
    expect(
      standardDaysUntilExpiry(
        validThroughIso,
        new Date("2026-10-16T02:30:00.000Z"),
      ),
    ).toBe(0);
    // 22:00 on the 14th in Sao Paulo (already the 15th in UTC).
    expect(
      standardDaysUntilExpiry(
        validThroughIso,
        new Date("2026-10-15T01:00:00.000Z"),
      ),
    ).toBe(1);
    expect(
      standardDaysUntilExpiry(
        "2026-10-15",
        new Date("2026-10-16T03:10:00.000Z"),
      ),
    ).toBe(-1);
    expect(standardDaysUntilExpiry("nope")).toBeNull();
  });

  it("never accepts a standard whose validity is missing or unreadable", () => {
    const performedAt = new Date("2026-10-01T12:00:00.000Z");
    expect(isStandardValidOn("not a date", performedAt)).toBe(false);
    expect(isStandardValidOn("", performedAt)).toBe(false);
    expect(isStandardValidOn(new Date(Number.NaN), performedAt)).toBe(false);
  });
});

describe("assessStandardValidity (REQ-CAL-004)", () => {
  const standard = (name: string, next: string) => ({
    name,
    nextCalibrationDate: next,
  });
  // Performed on the 13th (noon in Sao Paulo), judged on the 16th at 10:00.
  const performedAt = new Date("2026-10-13T15:00:00.000Z");
  const now = new Date("2026-10-16T13:00:00.000Z");

  it("separates a standard expired at the performed day from one that expired only afterwards", () => {
    const result = assessStandardValidity(
      [
        standard("valid today", "2026-10-20"),
        standard("expired after the work", "2026-10-14"),
        standard("expired before the work", "2026-10-12"),
      ],
      performedAt,
      now,
    );
    expect(result.expiredAtPerformed).toEqual(["expired before the work"]);
    expect(result.validOnlyBecauseBackdated).toEqual([
      "expired after the work",
    ]);
  });

  it("is not backdate-dependent on the standard's last valid day, until that day is over", () => {
    const lastDay = [standard("last day", "2026-10-16")];
    expect(
      assessStandardValidity(lastDay, performedAt, now)
        .validOnlyBecauseBackdated,
    ).toEqual([]);
    // 00:10 on the 17th in Sao Paulo: it expired after the work was done.
    expect(
      assessStandardValidity(
        lastDay,
        performedAt,
        new Date("2026-10-17T03:10:00.000Z"),
      ).validOnlyBecauseBackdated,
    ).toEqual(["last day"]);
  });

  it("treats an unreadable validity as expired at the performed day", () => {
    expect(
      assessStandardValidity([standard("broken", "nope")], performedAt, now)
        .expiredAtPerformed,
    ).toEqual(["broken"]);
  });
});
