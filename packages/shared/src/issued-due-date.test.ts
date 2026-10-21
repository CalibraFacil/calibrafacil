import { describe, expect, it } from "vitest";
import { resolveIssuedDueDate } from "./finance";

// REQ-CAL-003: a billing document's due date is a calendar day. Issuing keeps
// the one already negotiated when it is after the issue day in the laboratory
// (Sao Paulo), and falls back to the default terms otherwise.
describe("resolveIssuedDueDate", () => {
  // 23:30 on 2026-10-15 in Sao Paulo is 02:30Z on the 16th: the UTC day has
  // rolled over, the laboratory's has not.
  const lateEvening = new Date("2026-10-16T02:30:00.000Z");

  it("keeps a due date of tomorrow in the laboratory when issuing between 21:00 and 24:00", () => {
    const tomorrow = new Date("2026-10-16T00:00:00.000Z");
    expect(resolveIssuedDueDate(tomorrow, lateEvening)).toBe(tomorrow);
  });

  it("keeps a later due date", () => {
    const later = new Date("2026-11-20T00:00:00.000Z");
    expect(resolveIssuedDueDate(later, lateEvening)).toBe(later);
  });

  it("replaces a due date that is today or earlier with the default terms", () => {
    const today = new Date("2026-10-15T00:00:00.000Z");
    const replaced = resolveIssuedDueDate(today, lateEvening);
    expect(replaced).not.toBe(today);
    expect(replaced.getTime()).toBeGreaterThan(lateEvening.getTime());
    expect(
      resolveIssuedDueDate(
        new Date("2026-10-01T00:00:00.000Z"),
        lateEvening,
      ).getTime(),
    ).toBeGreaterThan(lateEvening.getTime());
  });

  it("uses the default terms when there is no due date", () => {
    expect(resolveIssuedDueDate(null, lateEvening).getTime()).toBeGreaterThan(
      lateEvening.getTime(),
    );
  });
});
