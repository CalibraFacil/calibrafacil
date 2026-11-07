import { describe, expect, it } from "vitest";
import { getDashboardWindows } from "./dashboard-windows";

describe("dashboard windows (REQ-DATE-009)", () => {
  // 23:30 in Sao Paulo on 2026-05-31 is 02:30Z on 2026-06-01.
  const lastEveningOfMay = new Date("2026-05-31T23:30:00-03:00");

  it("keeps the month and today on the laboratory calendar late in the evening", () => {
    const windows = getDashboardWindows(lastEveningOfMay);

    // May still: it began at midnight on the 1st in Sao Paulo.
    expect(windows.startOfMonth.toISOString()).toBe("2026-05-01T03:00:00.000Z");
    // "Due today" runs to the end of the 31st in Sao Paulo.
    expect(windows.endOfToday.toISOString()).toBe("2026-06-01T02:59:59.999Z");
  });

  it("offsets the rolling windows from the same instant", () => {
    const windows = getDashboardWindows(lastEveningOfMay);

    expect(windows.thirtyDaysFromNow.toISOString()).toBe(
      "2026-07-01T02:30:00.000Z",
    );
    expect(windows.sevenDaysFromNow.toISOString()).toBe(
      "2026-06-08T02:30:00.000Z",
    );
    expect(windows.ninetyDaysAgo.toISOString()).toBe(
      "2026-03-03T02:30:00.000Z",
    );
  });
});
