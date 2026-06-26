import { describe, expect, it } from "vitest";

import { buildAsFoundReliabilityVerdict } from "./as-found-reliability-verdict";

describe("buildAsFoundReliabilityVerdict", () => {
  // REQ-RELIA-001 + REQ-RELIA-002: reads `margem_conformidade_antes`; all ≥ 0 → CONFORMING.
  it("reports CONFORMING when every as-found margin is within tolerance", () => {
    const verdict = buildAsFoundReliabilityVerdict({
      results: { margem_conformidade_antes: [0.5, 1.2, 0] },
    });
    expect(verdict.conformity).toBe("CONFORMING");
    expect(verdict.pointsTotal).toBe(3);
    expect(verdict.pointsWithin).toBe(3);
  });

  // REQ-RELIA-003: any as-found margin < 0 → NON_CONFORMING.
  it("reports NON_CONFORMING when any as-found margin is out of tolerance", () => {
    const verdict = buildAsFoundReliabilityVerdict({
      results: { margem_conformidade_antes: [0.5, -0.1, 0.3] },
    });
    expect(verdict.conformity).toBe("NON_CONFORMING");
    expect(verdict.pointsTotal).toBe(3);
    expect(verdict.pointsWithin).toBe(2);
  });

  // REQ-RELIA-004: no as-found margin → UNKNOWN.
  it("reports UNKNOWN when no as-found margins are present", () => {
    expect(buildAsFoundReliabilityVerdict({ results: {} }).conformity).toBe(
      "UNKNOWN",
    );
    expect(buildAsFoundReliabilityVerdict({ results: null }).conformity).toBe(
      "UNKNOWN",
    );
    expect(
      buildAsFoundReliabilityVerdict({ results: undefined }).conformity,
    ).toBe("UNKNOWN");
  });

  // REQ-RELIA-004 (the load-bearing guard): MUST NOT substitute the as-left
  // (`margem_conformidade_apos`) margin when the as-found key is absent. A job with
  // only a rosy as-left result is UNKNOWN, never CONFORMING.
  it("does NOT fall back to as-left margins (margem_conformidade_apos)", () => {
    const verdict = buildAsFoundReliabilityVerdict({
      results: { margem_conformidade_apos: [1.0, 2.0, 3.0] },
    });
    expect(verdict.conformity).toBe("UNKNOWN");
    expect(verdict.pointsTotal).toBe(0);
  });

  // REQ-RELIA-001/003 (the metrology rule end-to-end): as-found OOT must win even
  // when the instrument was adjusted back into tolerance (as-left all good). The
  // reliability signal is the arrival condition, not the departure condition.
  it("uses as-found even when as-left was adjusted back into tolerance", () => {
    const verdict = buildAsFoundReliabilityVerdict({
      results: {
        margem_conformidade_antes: [0.4, -0.2], // arrived out of tolerance
        margem_conformidade_apos: [0.6, 0.5], // adjusted back in
      },
    });
    expect(verdict.conformity).toBe("NON_CONFORMING");
  });

  // REQ-RELIA-005: tolerate comma decimals and flatten nested point arrays.
  it("parses comma decimals and flattens nested arrays", () => {
    const verdict = buildAsFoundReliabilityVerdict({
      results: {
        margem_conformidade_antes: [["0,5", "0,1"], ["-0,3"]],
      },
    });
    expect(verdict.pointsTotal).toBe(3);
    expect(verdict.pointsWithin).toBe(2);
    expect(verdict.conformity).toBe("NON_CONFORMING");
    expect(verdict.margins).toEqual([0.5, 0.1, -0.3]);
  });

  // REQ-RELIA-006: counts + parsed margins are exposed for persistence (A2).
  it("exposes pointsTotal, pointsWithin, and the parsed margins", () => {
    const verdict = buildAsFoundReliabilityVerdict({
      results: { margem_conformidade_antes: [2, 0, -1, 5] },
    });
    expect(verdict.pointsTotal).toBe(4);
    expect(verdict.pointsWithin).toBe(3);
    expect(verdict.margins).toEqual([2, 0, -1, 5]);
  });
});
