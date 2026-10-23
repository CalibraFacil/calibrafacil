import { describe, expect, it } from "vitest";
import * as scheduled from "./scheduled";

// REQ-SPLIT-2: scheduled.ts became a re-export index over ./scheduled/*. The
// package export `@calibra-facil/jobs-core/scheduled` must keep exactly the
// runtime surface the cron dispatcher and the dispatcher module use.
describe("jobs-core/scheduled entry point", () => {
  it("REQ-SPLIT-2 exports exactly the original runtime surface", () => {
    expect(Object.keys(scheduled).sort()).toEqual([
      "processPortalDigest",
      "processScheduledNotifications",
    ]);
  });

  it("REQ-SPLIT-2 exports the handlers as functions", () => {
    expect(typeof scheduled.processPortalDigest).toBe("function");
    expect(typeof scheduled.processScheduledNotifications).toBe("function");
  });
});
