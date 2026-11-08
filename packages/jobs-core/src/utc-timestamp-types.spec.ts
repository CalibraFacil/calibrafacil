import { afterEach, describe, expect, it } from "vitest";
import { utcTimestampTypes } from "./pdf-render";

const TIMESTAMP_WITHOUT_TIME_ZONE_OID = 1114;
const originalTz = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTz;
});

describe("utcTimestampTypes", () => {
  it.each(["UTC", "America/Sao_Paulo", "Pacific/Kiritimati"])(
    "reads a timestamp without time zone as UTC whatever the host zone (%s)",
    (zone) => {
      process.env.TZ = zone;
      const parse = utcTimestampTypes.getTypeParser(
        TIMESTAMP_WITHOUT_TIME_ZONE_OID,
        "text",
      );

      expect(parse("2026-11-08 12:34:56.789").toISOString()).toBe(
        "2026-11-08T12:34:56.789Z",
      );
    },
  );

  it.each(["UTC", "America/Sao_Paulo", "Pacific/Kiritimati"])(
    "reads a date as that day's UTC midnight whatever the host zone (%s)",
    (zone) => {
      process.env.TZ = zone;
      const parse = utcTimestampTypes.getTypeParser(1082, "text");

      expect(parse("2025-01-01").toISOString()).toBe(
        "2025-01-01T00:00:00.000Z",
      );
    },
  );

  it("keeps infinity readable", () => {
    const parse = utcTimestampTypes.getTypeParser(
      TIMESTAMP_WITHOUT_TIME_ZONE_OID,
      "text",
    );

    expect(parse("infinity")).toBe(Infinity);
  });
});
