import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatCalendarDateBR } from "./calendar-date-format";

// REQ-CAL-001: a calendar date (an instrument's next calibration, a standard's
// validity, a job's due date) comes back from a Postgres `date` column as UTC
// midnight of the day it names. The notification e-mails print that day, in
// whatever zone the server (or a developer's machine) runs.
describe("formatCalendarDateBR", () => {
  const originalTimeZone = process.env.TZ;

  beforeAll(() => {
    // A server in Brazil: UTC midnight reads as the evening before.
    process.env.TZ = "America/Sao_Paulo";
  });

  afterAll(() => {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  });

  it("prints the day a stored calendar date names", () => {
    const stored = new Date("2026-10-15T00:00:00.000Z");
    // The naive local formatting is the day before in this zone.
    expect(stored.toLocaleDateString("pt-BR")).toBe("14/10/2026");
    expect(formatCalendarDateBR(stored)).toBe("15/10/2026");
  });

  it("reads a value stored at another hour by the same rule (Sao Paulo day)", () => {
    expect(formatCalendarDateBR(new Date("2026-10-15T15:00:00.000Z"))).toBe(
      "15/10/2026",
    );
    // 22:30 on the 14th in Sao Paulo.
    expect(formatCalendarDateBR(new Date("2026-10-15T01:30:00.000Z"))).toBe(
      "14/10/2026",
    );
  });
});
