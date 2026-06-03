import { describe, it, expect } from "vitest";

import { addRfc3161Timestamp } from "./timestamp.js";

/**
 * The live TSA round-trip needs a reachable RFC-3161 endpoint (and, for
 * conformance, a contracted ICP-Brasil ACT), so it is exercised in integration,
 * not here. These tests pin the safe default: no TSA configured => no-op.
 */
describe("addRfc3161Timestamp", () => {
  it("returns the PDF unchanged when no config is given", async () => {
    const pdf = new Uint8Array([1, 2, 3, 4]);
    const outcome = await addRfc3161Timestamp(pdf, null);
    expect(outcome.timestamped).toBe(false);
    expect(outcome.icpBrasilConformant).toBe(false);
    expect(outcome.pdf).toBe(pdf);
  });

  it("treats an empty TSA URL as disabled", async () => {
    const pdf = new Uint8Array([9]);
    const outcome = await addRfc3161Timestamp(pdf, {
      tsaUrl: "",
      reason: "test",
    });
    expect(outcome.timestamped).toBe(false);
    expect(outcome.pdf).toBe(pdf);
  });
});
