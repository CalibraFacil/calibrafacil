import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LabelHtml } from "./LabelHtml.js";

// 01:30 UTC on 3 October is still 22:30 on 2 October at the laboratory.
const LATE_EVENING = "2026-10-03T01:30:00.000Z";

describe("LabelHtml", () => {
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
