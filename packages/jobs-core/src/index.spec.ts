import { describe, expect, it } from "vitest";
import * as jobsCore from "./index";

// REQ-SPLIT-2: index.ts used to hold every handler; it now only re-exports from
// the per-concern modules. The runtime surface (and the default queue-consumer
// object) must stay exactly what apps/worker and apps/api import. The type half
// (Env, QueueMessage, DeliveryAttempt, MessageBatch, ...) is held by
// `check-types` on those callers.
describe("jobs-core index", () => {
  it("REQ-SPLIT-2 exports exactly the original runtime surface", () => {
    expect(Object.keys(jobsCore).sort()).toEqual([
      "default",
      "isFinalDelivery",
      "processBackgroundJob",
      "resolvePdfRenderRequest",
    ]);
  });

  it("REQ-SPLIT-2 keeps the default export a queue/fetch/scheduled handler", () => {
    expect(Object.keys(jobsCore.default).sort()).toEqual([
      "fetch",
      "queue",
      "scheduled",
    ]);
    for (const handler of Object.values(jobsCore.default)) {
      expect(typeof handler).toBe("function");
    }
  });

  it("REQ-SPLIT-2 exports the functions as functions", () => {
    expect(typeof jobsCore.isFinalDelivery).toBe("function");
    expect(typeof jobsCore.processBackgroundJob).toBe("function");
    expect(typeof jobsCore.resolvePdfRenderRequest).toBe("function");
  });
});
