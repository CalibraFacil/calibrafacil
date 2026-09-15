import { describe, expect, it } from "vitest";
import { portalDigestFrequenciesFor } from "./portal-digest";

// All dates are constructed with explicit UTC timestamps (`...Z` suffix) so
// that the tests are independent of the host machine's local timezone.

describe("portalDigestFrequenciesFor", () => {
  // REQ-DIG-001: Monday UTC → both DAILY and WEEKLY, in that order
  it("REQ-DIG-001: returns ['DAILY', 'WEEKLY'] on a Monday in UTC", () => {
    // 2026-06-22T12:00:00Z → getUTCDay() === 1 (Monday)
    const monday = new Date("2026-06-22T12:00:00Z");
    expect(monday.getUTCDay()).toBe(1); // guard: confirm day
    expect(portalDigestFrequenciesFor(monday)).toStrictEqual([
      "DAILY",
      "WEEKLY",
    ]);
  });

  // REQ-DIG-002: non-Monday UTC days → DAILY only
  it("REQ-DIG-002: returns ['DAILY'] on Sunday (UTC day 0)", () => {
    // 2026-06-21T12:00:00Z → getUTCDay() === 0 (Sunday)
    const sunday = new Date("2026-06-21T12:00:00Z");
    expect(sunday.getUTCDay()).toBe(0);
    expect(portalDigestFrequenciesFor(sunday)).toStrictEqual(["DAILY"]);
  });

  it("REQ-DIG-002: returns ['DAILY'] on Tuesday (UTC day 2)", () => {
    // 2026-06-23T12:00:00Z → getUTCDay() === 2 (Tuesday)
    const tuesday = new Date("2026-06-23T12:00:00Z");
    expect(tuesday.getUTCDay()).toBe(2);
    expect(portalDigestFrequenciesFor(tuesday)).toStrictEqual(["DAILY"]);
  });

  it("REQ-DIG-002: returns ['DAILY'] on Wednesday (UTC day 3)", () => {
    const wednesday = new Date("2026-06-24T12:00:00Z");
    expect(wednesday.getUTCDay()).toBe(3);
    expect(portalDigestFrequenciesFor(wednesday)).toStrictEqual(["DAILY"]);
  });

  it("REQ-DIG-002: returns ['DAILY'] on Thursday (UTC day 4)", () => {
    const thursday = new Date("2026-06-25T12:00:00Z");
    expect(thursday.getUTCDay()).toBe(4);
    expect(portalDigestFrequenciesFor(thursday)).toStrictEqual(["DAILY"]);
  });

  it("REQ-DIG-002: returns ['DAILY'] on Friday (UTC day 5)", () => {
    const friday = new Date("2026-06-26T12:00:00Z");
    expect(friday.getUTCDay()).toBe(5);
    expect(portalDigestFrequenciesFor(friday)).toStrictEqual(["DAILY"]);
  });

  it("REQ-DIG-002: returns ['DAILY'] on Saturday (UTC day 6)", () => {
    const saturday = new Date("2026-06-27T12:00:00Z");
    expect(saturday.getUTCDay()).toBe(6);
    expect(portalDigestFrequenciesFor(saturday)).toStrictEqual(["DAILY"]);
  });

  // REQ-DIG-003: classification is by UTC day, not local time
  //
  // Case A: Monday UTC but Sunday in a UTC-5 zone.
  //   2026-06-22T00:30:00Z → getUTCDay() === 1 (Monday UTC)
  //   In UTC-5 local time this is 2026-06-21 19:30 (Sunday) — must still fire WEEKLY.
  it("REQ-DIG-003: classifies by UTC — Monday UTC / Sunday local → ['DAILY','WEEKLY']", () => {
    const mondayUtcSundayLocal = new Date("2026-06-22T00:30:00Z");
    expect(mondayUtcSundayLocal.getUTCDay()).toBe(1); // Monday UTC
    expect(portalDigestFrequenciesFor(mondayUtcSundayLocal)).toStrictEqual([
      "DAILY",
      "WEEKLY",
    ]);
  });

  // Case B: Sunday UTC but Monday in a UTC+12 zone.
  //   2026-06-21T23:30:00Z → getUTCDay() === 0 (Sunday UTC)
  //   In UTC+12 local time this is 2026-06-22 11:30 (Monday) — must NOT fire WEEKLY.
  it("REQ-DIG-003: classifies by UTC — Sunday UTC / Monday local → ['DAILY']", () => {
    const sundayUtcMondayLocal = new Date("2026-06-21T23:30:00Z");
    expect(sundayUtcMondayLocal.getUTCDay()).toBe(0); // Sunday UTC
    expect(portalDigestFrequenciesFor(sundayUtcMondayLocal)).toStrictEqual([
      "DAILY",
    ]);
  });
});
