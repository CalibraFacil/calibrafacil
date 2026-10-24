import { describe, expect, it } from "vitest";
import * as integrations from "./integrations";

// REQ-SPLIT-2: integrations.ts became a re-export index over ./integrations/*.
// The package export `@calibra-facil/jobs-core/integrations` must keep exactly
// the runtime surface apps/api and the dispatcher use. The type half
// (IntegrationSyncQueueMessage) is held by `check-types` on its importers.
describe("jobs-core/integrations entry point", () => {
  it("REQ-SPLIT-2 exports exactly the original runtime surface", () => {
    // P2-18j: plus the error a scheduled sweep throws at its end when some
    // laboratories failed (it carries what the sweep did).
    expect(Object.keys(integrations).sort()).toEqual([
      "ScheduledIntegrationSyncError",
      "processIntegrationSync",
      "processScheduledIntegrationSyncs",
    ]);
  });

  it("REQ-SPLIT-2 exports the handlers as functions", () => {
    expect(typeof integrations.processIntegrationSync).toBe("function");
    expect(typeof integrations.processScheduledIntegrationSyncs).toBe(
      "function",
    );
  });
});
