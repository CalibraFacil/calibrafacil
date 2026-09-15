import { describe, expect, it } from "vitest";

import {
  ALL_SPC_RULES,
  cusumSignals,
  detectRuleHits,
  evaluateChart,
  ewmaSignals,
  iMrLimits,
  MIN_PLOTTED_POINTS,
  SPC_ENGINE_VERSION,
  xbarRLimits,
} from "./spc";

/** Stable in-control series: alternating small deviations around 10. */
const STABLE = [
  10.01, 9.99, 10.02, 9.98, 10.0, 10.01, 9.99, 10.02, 9.98, 10.0, 10.01, 9.99,
];

describe("iMrLimits", () => {
  it("computes x̄ ± 3σ with σ = MR̄/1.128 (NIST §6.3.2.2)", () => {
    const values = [10, 12, 11, 13, 12, 14];
    // moving ranges: 2,1,2,1,2 → MR̄ = 1.6; centerline = 12
    const limits = iMrLimits(values);
    expect(limits?.centerline).toBeCloseTo(12, 10);
    expect(limits?.sigma).toBeCloseTo(1.6 / 1.128, 10);
    // x̄ ± 2.66·MR̄ equivalence: 3·(MR̄/1.128) = 2.6596·MR̄
    expect(limits?.ucl).toBeCloseTo(12 + (3 * 1.6) / 1.128, 10);
    expect(limits?.lcl).toBeCloseTo(12 - (3 * 1.6) / 1.128, 10);
    // MR chart: UCL = 3.267·MR̄, LCL = 0
    expect(limits?.secondaryUcl).toBeCloseTo(3.267 * 1.6, 10);
    expect(limits?.secondaryLcl).toBe(0);
  });
  it("honors frozen centerline/sigma", () => {
    const limits = iMrLimits([10, 12, 11, 13], {
      centerline: 10,
      sigma: 0.5,
    });
    expect(limits?.centerline).toBe(10);
    expect(limits?.ucl).toBeCloseTo(11.5, 10);
  });
  it("returns null for fewer than 2 points", () => {
    expect(iMrLimits([10])).toBeNull();
  });
});

describe("xbarRLimits", () => {
  it("computes x̿ ± A₂·R̄ and D₃/D₄·R̄ for n=5", () => {
    const means = [10, 10.2, 9.8, 10.1];
    const ranges = [1, 1.2, 0.8, 1];
    const limits = xbarRLimits(means, ranges, 5);
    const rBar = 1;
    expect(limits?.centerline).toBeCloseTo(10.025, 10);
    expect(limits?.ucl).toBeCloseTo(10.025 + 0.577 * rBar, 10);
    expect(limits?.lcl).toBeCloseTo(10.025 - 0.577 * rBar, 10);
    expect(limits?.secondaryUcl).toBeCloseTo(2.114 * rBar, 10);
    expect(limits?.secondaryLcl).toBeCloseTo(0, 10);
  });
  it("returns null for unsupported subgroup sizes", () => {
    expect(xbarRLimits([10, 10], [1, 1], 11)).toBeNull();
    expect(xbarRLimits([10, 10], [1, 1], 1)).toBeNull();
  });
});

describe("detectRuleHits — Western Electric zone rules", () => {
  const enabled = ALL_SPC_RULES;

  it("rule 1: flags a point beyond 3σ as out_of_control", () => {
    const values = [...STABLE, 10.5]; // centerline 10, sigma 0.1 → z = 5
    const hits = detectRuleHits(values, 10, 0.1, enabled);
    const rule1 = hits.find((h) => h.rule === "weco_1_beyond_3sigma");
    expect(rule1?.severity).toBe("out_of_control");
    expect(rule1?.pointIndices).toEqual([values.length - 1]);
  });

  it("rule 2: flags 2 of 3 consecutive beyond 2σ on the same side", () => {
    const values = [10, 10, 10.25, 10.0, 10.25, 10, 10, 10];
    const hits = detectRuleHits(values, 10, 0.1, enabled);
    const rule2 = hits.find((h) => h.rule === "weco_2_of_3_beyond_2sigma");
    expect(rule2?.severity).toBe("out_of_control");
    expect(rule2?.pointIndices).toEqual([2, 4]);
  });

  it("rule 2 does NOT fire for opposite sides", () => {
    const values = [10, 10, 10.25, 10.0, 9.75, 10, 10, 10];
    const hits = detectRuleHits(values, 10, 0.1, enabled);
    expect(
      hits.find((h) => h.rule === "weco_2_of_3_beyond_2sigma"),
    ).toBeUndefined();
  });

  it("rule 3: flags 4 of 5 consecutive beyond 1σ same side as trending", () => {
    const values = [10, 10.15, 10.15, 10.0, 10.15, 10.15, 10, 10];
    const hits = detectRuleHits(values, 10, 0.1, enabled);
    const rule3 = hits.find((h) => h.rule === "weco_4_of_5_beyond_1sigma");
    expect(rule3?.severity).toBe("trending");
    expect(rule3?.pointIndices).toEqual([1, 2, 4, 5]);
  });

  it("rule 4: flags 8 consecutive points on the same side as trending", () => {
    const values = [
      10.05, 10.04, 10.06, 10.05, 10.04, 10.06, 10.05, 10.04, 9.99,
    ];
    const hits = detectRuleHits(values, 10, 0.1, enabled);
    const rule4 = hits.find((h) => h.rule === "weco_8_consecutive_same_side");
    expect(rule4?.severity).toBe("trending");
    expect(rule4?.pointIndices).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("trend rule: 6 consecutive monotonic points", () => {
    const values = [10.0, 10.01, 10.02, 10.03, 10.04, 10.05, 10.0, 10.0];
    const hits = detectRuleHits(values, 10, 0.5, enabled);
    const trend = hits.find((h) => h.rule === "trend_6_monotonic");
    expect(trend?.severity).toBe("trending");
    expect(trend?.pointIndices).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("alternating rule: 14 consecutive alternating points", () => {
    const values: number[] = [];
    for (let i = 0; i < 14; i += 1) values.push(i % 2 === 0 ? 10.01 : 9.99);
    values.push(9.98, 9.97); // same direction as the last increment — breaks the alternation
    const hits = detectRuleHits(values, 10, 0.5, enabled);
    const alt = hits.find((h) => h.rule === "trend_14_alternating");
    expect(alt?.severity).toBe("trending");
    expect(alt?.pointIndices).toEqual([...Array(14).keys()]);
  });

  it("respects the enabledRules toggle", () => {
    const values = [...STABLE, 10.5];
    const hits = detectRuleHits(values, 10, 0.1, [
      "weco_8_consecutive_same_side",
    ]);
    expect(hits.find((h) => h.rule === "weco_1_beyond_3sigma")).toBeUndefined();
  });

  it("returns nothing for non-positive sigma", () => {
    expect(detectRuleHits([10, 20, 30], 10, 0, ALL_SPC_RULES)).toEqual([]);
  });
});

describe("cusumSignals", () => {
  it("stays silent for an in-control series", () => {
    expect(cusumSignals(STABLE, 10, 0.015)).toEqual([]);
  });
  it("accumulates and signals a small sustained shift (NIST §6.3.2.3)", () => {
    // Shift of +1σ from point 5 on: individual points never cross 3σ,
    // but the cumulative sum crosses h = 4σ.
    const shifted = [
      10, 10, 10, 10, 10, 10.1, 10.1, 10.1, 10.1, 10.1, 10.1, 10.1, 10.1, 10.1,
      10.1,
    ];
    const signals = cusumSignals(shifted, 10, 0.1, 0.5, 4);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals[0]).toBeGreaterThanOrEqual(5);
  });
  it("detects downward shifts symmetrically", () => {
    const shifted = [
      10, 10, 10, 10, 10, 9.9, 9.9, 9.9, 9.9, 9.9, 9.9, 9.9, 9.9, 9.9, 9.9,
    ];
    expect(cusumSignals(shifted, 10, 0.1, 0.5, 4).length).toBeGreaterThan(0);
  });
});

describe("ewmaSignals", () => {
  it("stays silent for an in-control series", () => {
    expect(ewmaSignals(STABLE, 10, 0.015)).toEqual([]);
  });
  it("signals a sustained small shift with exact time-varying limits", () => {
    const shifted = [
      10, 10, 10, 10.15, 10.15, 10.15, 10.15, 10.15, 10.15, 10.15,
    ];
    const signals = ewmaSignals(shifted, 10, 0.1, 0.2, 3);
    expect(signals.length).toBeGreaterThan(0);
  });
  it("rejects invalid lambda", () => {
    expect(ewmaSignals(STABLE, 10, 0.1, 0)).toEqual([]);
    expect(ewmaSignals(STABLE, 10, 0.1, 1.5)).toEqual([]);
  });
});

describe("evaluateChart", () => {
  it("returns insufficient_data below the minimum plotted points", () => {
    const result = evaluateChart([10, 10.1, 9.9], "i_mr");
    expect(result.status).toBe("insufficient_data");
    expect(result.sampleSize).toBe(3);
    expect(result.limits).toBeNull();
    expect(result.engineVersion).toBe(SPC_ENGINE_VERSION);
    expect(result.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("classifies a stable series as in_control", () => {
    const result = evaluateChart(STABLE, "i_mr");
    expect(result.status).toBe("in_control");
    expect(result.ruleHits).toEqual([]);
    expect(result.limits?.centerline).toBeCloseTo(10, 2);
  });

  it("classifies a 3σ breach as out_of_control", () => {
    // Freeze the baseline so the spike cannot inflate the limits.
    const result = evaluateChart([...STABLE, 10.6], "i_mr", {
      baselineWindow: STABLE.length,
    });
    expect(result.status).toBe("out_of_control");
    expect(result.ruleHits.some((h) => h.rule === "weco_1_beyond_3sigma")).toBe(
      true,
    );
  });

  it("classifies a sustained same-side run as trending", () => {
    const drifted = [
      ...STABLE,
      10.03,
      10.03,
      10.03,
      10.03,
      10.03,
      10.03,
      10.03,
      10.03,
    ];
    const result = evaluateChart(drifted, "i_mr", {
      baselineWindow: STABLE.length,
      enabledRules: ["weco_8_consecutive_same_side"],
    });
    expect(result.status).toBe("trending");
  });

  it("is deterministic: same inputs produce the same fingerprint", () => {
    const a = evaluateChart(STABLE, "i_mr", { baselineWindow: 10 });
    const b = evaluateChart(STABLE, "i_mr", { baselineWindow: 10 });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a).toEqual(b);
    const c = evaluateChart(STABLE, "i_mr", { baselineWindow: 11 });
    expect(c.fingerprint).not.toBe(a.fingerprint);
  });

  it("groups consecutive readings into subgroups for xbar_r", () => {
    // 40 readings → 8 subgroups of 5
    const values: number[] = [];
    for (let i = 0; i < 40; i += 1) values.push(10 + (i % 5) * 0.01);
    const result = evaluateChart(values, "xbar_r", { subgroupSize: 5 });
    expect(result.sampleSize).toBe(8);
    expect(result.limits?.secondaryUcl).toBeGreaterThan(0);
  });

  it("xbar_r with too few subgroups is insufficient_data", () => {
    const result = evaluateChart([10, 10, 10, 10, 10, 10], "xbar_r", {
      subgroupSize: 5,
    });
    expect(result.status).toBe("insufficient_data");
    expect(result.sampleSize).toBe(1);
  });

  it("cusum chart flags a sustained 1σ shift the Shewhart rules can miss", () => {
    const base = [10.01, 9.99, 10.02, 9.98, 10.0, 10.01, 9.99, 10.02];
    const shifted = [...base, ...Array.from({ length: 12 }, () => 10.03)];
    const result = evaluateChart(shifted, "cusum", {
      baselineWindow: base.length,
      enabledRules: ["cusum_signal"],
    });
    expect(result.status).toBe("out_of_control");
    expect(result.ruleHits[0]?.rule).toBe("cusum_signal");
  });

  it("ewma chart flags a sustained small shift", () => {
    const base = [10.01, 9.99, 10.02, 9.98, 10.0, 10.01, 9.99, 10.02];
    const shifted = [...base, ...Array.from({ length: 12 }, () => 10.04)];
    const result = evaluateChart(shifted, "ewma", {
      baselineWindow: base.length,
      enabledRules: ["ewma_beyond_limits"],
    });
    expect(result.status).toBe("out_of_control");
    expect(result.ruleHits[0]?.rule).toBe("ewma_beyond_limits");
  });

  it("a constant series (sigma = 0) is insufficient_data, not in_control", () => {
    const result = evaluateChart(
      Array.from({ length: 12 }, () => 10),
      "i_mr",
    );
    expect(result.status).toBe("insufficient_data");
  });

  it("exports a sane minimum-points constant", () => {
    expect(MIN_PLOTTED_POINTS).toBeGreaterThanOrEqual(4);
  });
});
