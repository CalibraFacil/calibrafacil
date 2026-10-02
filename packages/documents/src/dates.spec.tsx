import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  formatCalendarDate,
  formatLabDate,
  formatLabDateTime,
} from "./dates.js";
import { LabelHtml } from "./LabelHtml.js";

// 01:30 UTC on 3 October is still 22:30 on 2 October at the laboratory.
const LATE_EVENING = "2026-10-03T01:30:00.000Z";

describe("document dates", () => {
  it("shows a moment in the laboratory's time zone", () => {
    expect(formatLabDateTime(LATE_EVENING)).toBe("02/10/2026, 22:30");
    expect(formatLabDate(new Date(LATE_EVENING))).toBe("02/10/2026");
  });

  it("keeps a calendar date stored at UTC midnight on its own day", () => {
    const calibrationDate = "2026-10-15T00:00:00.000Z";

    expect(formatCalendarDate(calibrationDate)).toBe("15/10/2026");
    // Read as a moment it would move back a day.
    expect(formatLabDate(calibrationDate)).toBe("14/10/2026");
  });

  it("falls back for a missing or invalid value", () => {
    expect(formatLabDate(null)).toBe("—");
    expect(formatLabDateTime(undefined, "-")).toBe("-");
    expect(formatCalendarDate("not a date")).toBe("—");
  });

  it("prints a label with the day the calibration was performed at the lab", () => {
    const html = renderToStaticMarkup(
      <LabelHtml
        label={{
          jobId: "CAL-2026-0001",
          labName: "Laboratório",
          assetTag: "BAL-07",
          calibrationDate: LATE_EVENING,
          qrCodeDataUrl: "data:image/png;base64,",
        }}
      />,
    );

    expect(html).toContain("02/10/2026");
    expect(html).not.toContain("03/10/2026");
  });
});
