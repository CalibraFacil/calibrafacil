import { describe, expect, it } from "vitest";
import {
  evaluateScopeCompliance,
  extractScopeEvaluationPoints,
  roundToSignificantDigits,
  type AccreditedScopeLineLike,
  type ScopeEvaluationPoint,
} from "./scope-compliance";

const AT_DATE = new Date("2026-07-15T12:00:00Z");

const massLine: AccreditedScopeLineLike = {
  id: 1,
  quantityKind: "mass",
  rangeMin: 0,
  rangeMax: 500,
  rangeUnit: "g",
  cmcType: "fixed",
  cmcA: 0.01,
  cmcB: null,
  cmcUnit: "g",
  coverageFactor: 2,
};

function point(overrides: Partial<ScopeEvaluationPoint>): ScopeEvaluationPoint {
  return {
    value: 100,
    unit: "g",
    expandedUncertainty: 0.02,
    uncertaintyUnit: "g",
    coverageFactor: 2,
    ...overrides,
  };
}

describe("evaluateScopeCompliance", () => {
  it("passes when U is above the CMC", () => {
    const result = evaluateScopeCompliance({
      scopeLines: [massLine],
      points: [point({ expandedUncertainty: 0.02 })],
      atDate: AT_DATE,
    });
    expect(result.status).toBe("PASS");
    expect(result.findings).toEqual([]);
    expect(result.pointsEvaluated).toBe(1);
  });

  it("passes the U == CMC boundary (ILAC P14: 'not less than')", () => {
    const result = evaluateScopeCompliance({
      scopeLines: [massLine],
      points: [point({ expandedUncertainty: 0.01 })],
      atDate: AT_DATE,
    });
    expect(result.status).toBe("PASS");
  });

  it("flags U one step below the CMC", () => {
    const result = evaluateScopeCompliance({
      scopeLines: [massLine],
      points: [point({ expandedUncertainty: 0.009 })],
      atDate: AT_DATE,
    });
    expect(result.status).toBe("U_BELOW_CMC");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      kind: "u_below_cmc",
      cmcValue: 0.01,
      cmcUnit: "g",
      scopeLineId: 1,
    });
  });

  it("treats range edges as in scope (inclusive bounds)", () => {
    const result = evaluateScopeCompliance({
      scopeLines: [massLine],
      points: [
        point({ value: 0 }),
        point({ value: 500 }),
      ],
      atDate: AT_DATE,
    });
    expect(result.status).toBe("PASS");
    expect(result.pointsEvaluated).toBe(2);
  });

  it("flags a point just outside the range as out of scope", () => {
    const result = evaluateScopeCompliance({
      scopeLines: [massLine],
      points: [point({ value: 500.01 })],
      atDate: AT_DATE,
    });
    expect(result.status).toBe("OUT_OF_SCOPE");
    expect(result.findings[0]?.kind).toBe("out_of_scope");
  });

  it("matches ranges across units of the same kind without float noise", () => {
    const result = evaluateScopeCompliance({
      scopeLines: [massLine],
      // 0.5 kg == 500 g — must land inside the inclusive upper bound.
      points: [point({ value: 0.5, unit: "kg", expandedUncertainty: 0.02 })],
      atDate: AT_DATE,
    });
    expect(result.status).toBe("PASS");
  });

  it("normalizes the reported U from its coverage factor to k=2", () => {
    // U = 0.013 at k=2.6 → 0.01 at k=2 → equals the CMC → pass.
    const pass = evaluateScopeCompliance({
      scopeLines: [massLine],
      points: [point({ expandedUncertainty: 0.013, coverageFactor: 2.6 })],
      atDate: AT_DATE,
    });
    expect(pass.status).toBe("PASS");

    // Same numeric U at k=2 stays 0.013 → also pass; but at k=3 it shrinks
    // to ~0.0087 → below the CMC.
    const fail = evaluateScopeCompliance({
      scopeLines: [massLine],
      points: [point({ expandedUncertainty: 0.013, coverageFactor: 3 })],
      atDate: AT_DATE,
    });
    expect(fail.status).toBe("U_BELOW_CMC");
  });

  it("defaults the coverage factor to 2 when absent", () => {
    const result = evaluateScopeCompliance({
      scopeLines: [massLine],
      points: [point({ expandedUncertainty: 0.01, coverageFactor: null })],
      atDate: AT_DATE,
    });
    expect(result.status).toBe("PASS");
  });

  it("evaluates a linear CMC (a + b·x) across the range", () => {
    const linearLine: AccreditedScopeLineLike = {
      ...massLine,
      id: 2,
      cmcType: "linear",
      cmcA: 0.005,
      cmcB: 0.0001, // g per g of reading
    };
    // At 100 g: CMC = 0.005 + 0.01 = 0.015.
    const below = evaluateScopeCompliance({
      scopeLines: [linearLine],
      points: [point({ value: 100, expandedUncertainty: 0.012 })],
      atDate: AT_DATE,
    });
    expect(below.status).toBe("U_BELOW_CMC");
    expect(below.findings[0]?.cmcValue).toBeCloseTo(0.015, 12);

    const above = evaluateScopeCompliance({
      scopeLines: [linearLine],
      points: [point({ value: 100, expandedUncertainty: 0.015 })],
      atDate: AT_DATE,
    });
    expect(above.status).toBe("PASS");
  });

  it("supports percent-of-reading CMC expressed through the linear coefficient", () => {
    // 0.02 % of reading with no floor: a=0, b=0.0002 g/g.
    const relativeLine: AccreditedScopeLineLike = {
      ...massLine,
      id: 3,
      cmcType: "linear",
      cmcA: 0,
      cmcB: 0.0002,
    };
    const result = evaluateScopeCompliance({
      scopeLines: [relativeLine],
      points: [point({ value: 200, expandedUncertainty: 0.04 })],
      atDate: AT_DATE,
    });
    expect(result.status).toBe("PASS");
  });

  it("converts the reported U into the CMC unit before comparing", () => {
    const result = evaluateScopeCompliance({
      scopeLines: [massLine],
      // 0.00002 kg = 0.02 g ≥ CMC 0.01 g.
      points: [
        point({ expandedUncertainty: 0.00002, uncertaintyUnit: "kg" }),
      ],
      atDate: AT_DATE,
    });
    expect(result.status).toBe("PASS");
  });

  it("compares the U as it would be reported (2 significant digits)", () => {
    // Raw U 0.009996 rounds to 0.010 — the printed value equals the CMC.
    const result = evaluateScopeCompliance({
      scopeLines: [massLine],
      points: [point({ expandedUncertainty: 0.009996 })],
      atDate: AT_DATE,
    });
    expect(result.status).toBe("PASS");
  });

  it("passes when any of several overlapping matching lines covers the U", () => {
    const tighterLine: AccreditedScopeLineLike = {
      ...massLine,
      id: 4,
      cmcA: 0.001,
    };
    const result = evaluateScopeCompliance({
      scopeLines: [massLine, tighterLine],
      points: [point({ expandedUncertainty: 0.005 })],
      atDate: AT_DATE,
    });
    expect(result.status).toBe("PASS");
  });

  it("ignores scope lines outside their vigência window", () => {
    const expired: AccreditedScopeLineLike = {
      ...massLine,
      validUntil: "2026-01-01T00:00:00Z",
    };
    const result = evaluateScopeCompliance({
      scopeLines: [expired],
      points: [point({})],
      atDate: AT_DATE,
    });
    expect(result.status).toBe("OUT_OF_SCOPE");
  });

  it("ignores lines of a different quantity kind", () => {
    const temperatureLine: AccreditedScopeLineLike = {
      quantityKind: "temperature",
      rangeMin: -40,
      rangeMax: 150,
      rangeUnit: "°C",
      cmcType: "fixed",
      cmcA: 0.1,
      cmcUnit: "°C",
    };
    const result = evaluateScopeCompliance({
      scopeLines: [temperatureLine],
      points: [point({})],
      atDate: AT_DATE,
    });
    expect(result.status).toBe("OUT_OF_SCOPE");
  });

  it("converts temperature uncertainties as deltas, never absolutes", () => {
    const temperatureLine: AccreditedScopeLineLike = {
      quantityKind: "temperature",
      rangeMin: -40,
      rangeMax: 150,
      rangeUnit: "°C",
      cmcType: "fixed",
      cmcA: 0.1,
      cmcUnit: "°C",
    };
    // U of 0.1 K is a 0.1 °C delta (not 273.25 °C).
    const result = evaluateScopeCompliance({
      scopeLines: [temperatureLine],
      points: [
        {
          value: 50,
          unit: "°C",
          expandedUncertainty: 0.1,
          uncertaintyUnit: "K",
          coverageFactor: 2,
        },
      ],
      atDate: AT_DATE,
    });
    expect(result.status).toBe("PASS");
  });

  it("returns NOT_EVALUATED when there are no points", () => {
    const result = evaluateScopeCompliance({
      scopeLines: [massLine],
      points: [],
      atDate: AT_DATE,
    });
    expect(result.status).toBe("NOT_EVALUATED");
    expect(result.pointsTotal).toBe(0);
  });

  it("ranks OUT_OF_SCOPE above U_BELOW_CMC when both occur", () => {
    const result = evaluateScopeCompliance({
      scopeLines: [massLine],
      points: [
        point({ value: 600 }),
        point({ expandedUncertainty: 0.001 }),
      ],
      atDate: AT_DATE,
    });
    expect(result.status).toBe("OUT_OF_SCOPE");
    expect(result.findings).toHaveLength(2);
  });
});

describe("roundToSignificantDigits", () => {
  it("rounds to 2 significant digits half-up", () => {
    expect(roundToSignificantDigits(0.014449, 2)).toBeCloseTo(0.014, 12);
    expect(roundToSignificantDigits(0.0145, 2)).toBeCloseTo(0.015, 12);
    expect(roundToSignificantDigits(123.4, 2)).toBe(120);
    expect(roundToSignificantDigits(0, 2)).toBe(0);
  });
});

describe("extractScopeEvaluationPoints", () => {
  const formulas = [
    {
      outputKey: "incerteza_expandida_antes",
      unit: "g",
      scope: { kind: "table_row", tableKey: "pontos_indicacao" },
      reporting: {
        role: "expanded_uncertainty",
        group: "calibration_result",
      },
    },
    {
      outputKey: "incerteza_expandida_apos",
      unit: "g",
      scope: { kind: "table_row", tableKey: "pontos_indicacao" },
      reporting: {
        role: "expanded_uncertainty",
        group: "calibration_result",
      },
    },
    {
      outputKey: "u_combinada_apos",
      unit: "g",
      scope: { kind: "table_row", tableKey: "pontos_indicacao" },
      reporting: {
        role: "expanded_uncertainty",
        group: "uncertainty_budget",
      },
    },
    {
      outputKey: "fator_k_antes",
      scope: { kind: "table_row", tableKey: "pontos_indicacao" },
      reporting: { role: "coverage_factor", group: "uncertainty_budget" },
    },
    {
      outputKey: "fator_k_apos",
      scope: { kind: "table_row", tableKey: "pontos_indicacao" },
      reporting: { role: "coverage_factor", group: "uncertainty_budget" },
    },
  ];

  const dataFields = [
    {
      key: "pontos_indicacao",
      type: "table",
      weighingRangeResolver: { pointColumn: "carga_nominal", pointUnit: "g" },
      columns: [
        { key: "carga_nominal", type: "number", unit: "g" },
        { key: "valor_padrao", type: "number", unit: "g" },
      ],
    },
  ];

  const data = {
    pontos_indicacao: [
      { carga_nominal: 100, valor_padrao: 100.001 },
      { carga_nominal: 200, valor_padrao: 200.002 },
    ],
  };

  it("prefers the as-left (apos) series and pairs rows by index", () => {
    const points = extractScopeEvaluationPoints({
      data,
      results: {
        incerteza_expandida_antes: [0.05, 0.06],
        incerteza_expandida_apos: [0.02, 0.03],
        u_combinada_apos: [0.01, 0.015],
        fator_k_antes: [2.1, 2.2],
        fator_k_apos: [2.0, 2.65],
      },
      formulas,
      dataFields,
    });
    expect(points).toEqual([
      {
        value: 100,
        unit: "g",
        expandedUncertainty: 0.02,
        uncertaintyUnit: "g",
        coverageFactor: 2.0,
      },
      {
        value: 200,
        unit: "g",
        expandedUncertainty: 0.03,
        uncertaintyUnit: "g",
        coverageFactor: 2.65,
      },
    ]);
  });

  it("falls back to the as-found (antes) series when apos has no values", () => {
    const points = extractScopeEvaluationPoints({
      data,
      results: {
        incerteza_expandida_antes: [0.05, 0.06],
        fator_k_antes: [2.1, 2.2],
      },
      formulas,
      dataFields,
    });
    expect(points.map((p) => p.expandedUncertainty)).toEqual([0.05, 0.06]);
    expect(points.map((p) => p.coverageFactor)).toEqual([2.1, 2.2]);
  });

  it("falls back to well-known keys when the snapshot has no reporting roles", () => {
    const points = extractScopeEvaluationPoints({
      data,
      results: { incerteza_expandida_apos: [0.02, 0.03] },
      formulas: [
        {
          outputKey: "incerteza_expandida_apos",
          unit: "g",
          scope: { kind: "table_row", tableKey: "pontos_indicacao" },
        },
      ],
      dataFields,
    });
    expect(points).toHaveLength(2);
  });

  it("tolerates comma-decimal strings in rows and results", () => {
    const points = extractScopeEvaluationPoints({
      data: { pontos_indicacao: [{ carga_nominal: "100,5" }] },
      results: { incerteza_expandida_apos: ["0,02"] },
      formulas,
      dataFields,
    });
    expect(points).toEqual([
      {
        value: 100.5,
        unit: "g",
        expandedUncertainty: 0.02,
        uncertaintyUnit: "g",
        coverageFactor: null,
      },
    ]);
  });

  it("returns [] when the method emits no expanded uncertainty", () => {
    const points = extractScopeEvaluationPoints({
      data,
      results: { erro_indicacao_apos: [0.001, 0.002] },
      formulas,
      dataFields,
    });
    expect(points).toEqual([]);
  });

  it("returns [] when there are no table rows to pair with", () => {
    const points = extractScopeEvaluationPoints({
      data: {},
      results: { incerteza_expandida_apos: [0.02] },
      formulas,
      dataFields,
    });
    expect(points).toEqual([]);
  });
});

// ── Review-fix regressions (#427 stack self-review) ──────────────────────────

describe("evaluateScopeCompliance — CMC coverage-factor normalization", () => {
  it("scales a CMC stated at k≠2 before comparing", () => {
    // CMC 0.3 g at k=3 is 0.2 g at k=2 → U=0.25 g (k=2) must PASS.
    const k3Line: AccreditedScopeLineLike = {
      ...massLine,
      cmcA: 0.3,
      coverageFactor: 3,
    };
    const result = evaluateScopeCompliance({
      scopeLines: [k3Line],
      points: [point({ expandedUncertainty: 0.25 })],
      atDate: AT_DATE,
    });
    expect(result.status).toBe("PASS");

    // And a CMC stated at k=1 doubles at k=2 → U=0.015 g fails against
    // cmcA=0.01 @ k=1 (0.02 at k=2).
    const k1Line: AccreditedScopeLineLike = {
      ...massLine,
      cmcA: 0.01,
      coverageFactor: 1,
    };
    const below = evaluateScopeCompliance({
      scopeLines: [k1Line],
      points: [point({ expandedUncertainty: 0.015 })],
      atDate: AT_DATE,
    });
    expect(below.status).toBe("U_BELOW_CMC");
    expect(below.findings[0]?.cmcValue).toBeCloseTo(0.02, 12);
  });
});

describe("extractScopeEvaluationPoints — stored-canonical unit labeling", () => {
  const kgFormulas = [
    {
      outputKey: "incerteza_expandida_apos",
      unit: "kg",
      scope: { kind: "table_row", tableKey: "pontos_indicacao" },
      reporting: {
        role: "expanded_uncertainty",
        group: "calibration_result",
      },
    },
  ];
  const kgDataFields = [
    {
      key: "pontos_indicacao",
      type: "table",
      columns: [{ key: "carga_nominal", type: "number", unit: "kg" }],
    },
  ];

  it("labels values with the canonical unit when the declared unit shares the asset base kind", () => {
    // Technician entered 200 (kg); storage normalized it to 200000 g.
    const points = extractScopeEvaluationPoints({
      data: { pontos_indicacao: [{ carga_nominal: 200000 }] },
      results: { incerteza_expandida_apos: [2] }, // 2 g stored canonical
      formulas: kgFormulas,
      dataFields: kgDataFields,
      fallbackUnit: "kg",
    });
    expect(points).toEqual([
      {
        value: 200000,
        unit: "g",
        expandedUncertainty: 2,
        uncertaintyUnit: "g",
        coverageFactor: null,
      },
    ]);
    // End to end: a 0–300 kg scope line must match this point.
    const verdict = evaluateScopeCompliance({
      scopeLines: [
        {
          quantityKind: "mass",
          rangeMin: 0,
          rangeMax: 300,
          rangeUnit: "kg",
          cmcType: "fixed",
          cmcA: 1,
          cmcUnit: "g",
        },
      ],
      points,
      atDate: AT_DATE,
    });
    expect(verdict.status).toBe("PASS");
  });

  it("keeps the declared unit literal when no asset base unit exists (nothing was normalized)", () => {
    const points = extractScopeEvaluationPoints({
      data: { pontos_indicacao: [{ carga_nominal: 200 }] },
      results: { incerteza_expandida_apos: [0.002] },
      formulas: kgFormulas,
      dataFields: kgDataFields,
    });
    expect(points[0]?.unit).toBe("kg");
    expect(points[0]?.uncertaintyUnit).toBe("kg");
  });
});

describe("extractScopeEvaluationPoints — sparse result series stay row-aligned", () => {
  it("keeps null result entries in their slots instead of shifting later values", () => {
    const points = extractScopeEvaluationPoints({
      data: {
        pontos_indicacao: [
          { carga_nominal: 100 },
          { carga_nominal: 200 },
          { carga_nominal: 500 },
        ],
      },
      results: { incerteza_expandida_apos: [null, 0.02, 0.03] },
      formulas: [
        {
          outputKey: "incerteza_expandida_apos",
          unit: "g",
          scope: { kind: "table_row", tableKey: "pontos_indicacao" },
          reporting: {
            role: "expanded_uncertainty",
            group: "calibration_result",
          },
        },
      ],
      dataFields: [
        {
          key: "pontos_indicacao",
          type: "table",
          columns: [{ key: "carga_nominal", type: "number", unit: "g" }],
        },
      ],
    });
    // Point 100 (null U) is skipped; 200↔0.02 and 500↔0.03 stay paired.
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ value: 200, expandedUncertainty: 0.02 });
    expect(points[1]).toMatchObject({ value: 500, expandedUncertainty: 0.03 });
  });
});

describe("extractScopeEvaluationPoints — every uncertainty-bearing table is evaluated", () => {
  it("extracts points from BOTH tables when two carry their own U series", () => {
    const points = extractScopeEvaluationPoints({
      data: {
        pontos_indicacao: [{ carga_nominal: 100 }],
        pontos_faixa_2: [{ carga_nominal: 5000 }],
      },
      results: {
        incerteza_expandida_apos: [0.02],
        incerteza_expandida_faixa_2_apos: [5],
      },
      formulas: [
        {
          outputKey: "incerteza_expandida_apos",
          unit: "g",
          scope: { kind: "table_row", tableKey: "pontos_indicacao" },
          reporting: {
            role: "expanded_uncertainty",
            group: "calibration_result",
          },
        },
        {
          outputKey: "incerteza_expandida_faixa_2_apos",
          unit: "g",
          scope: { kind: "table_row", tableKey: "pontos_faixa_2" },
          reporting: {
            role: "expanded_uncertainty",
            group: "calibration_result",
          },
        },
      ],
      dataFields: [
        {
          key: "pontos_indicacao",
          type: "table",
          columns: [{ key: "carga_nominal", type: "number", unit: "g" }],
        },
        {
          key: "pontos_faixa_2",
          type: "table",
          columns: [{ key: "carga_nominal", type: "number", unit: "g" }],
        },
      ],
    });
    expect(points.map((p) => p.value).sort((a, b) => a - b)).toEqual([
      100, 5000,
    ]);
  });

  it("still prefers the as-left series within each table", () => {
    const points = extractScopeEvaluationPoints({
      data: { pontos_indicacao: [{ carga_nominal: 100 }] },
      results: {
        incerteza_expandida_antes: [0.09],
        incerteza_expandida_apos: [0.02],
      },
      formulas: [
        {
          outputKey: "incerteza_expandida_antes",
          unit: "g",
          scope: { kind: "table_row", tableKey: "pontos_indicacao" },
          reporting: {
            role: "expanded_uncertainty",
            group: "calibration_result",
          },
        },
        {
          outputKey: "incerteza_expandida_apos",
          unit: "g",
          scope: { kind: "table_row", tableKey: "pontos_indicacao" },
          reporting: {
            role: "expanded_uncertainty",
            group: "calibration_result",
          },
        },
      ],
      dataFields: [
        {
          key: "pontos_indicacao",
          type: "table",
          columns: [{ key: "carga_nominal", type: "number", unit: "g" }],
        },
      ],
    });
    expect(points).toHaveLength(1);
    expect(points[0]?.expandedUncertainty).toBe(0.02);
  });
});

describe("evaluateScopeCompliance — unresolvable points surface as not_evaluated findings", () => {
  it("emits a not_evaluated finding instead of a silent skip", () => {
    // Line matches the point's range but its cmcUnit kind cannot receive the
    // point's uncertainty unit (temperature U vs a mass CMC is impossible via
    // the registry, so force it with a broken uncertaintyUnit token).
    const result = evaluateScopeCompliance({
      scopeLines: [massLine],
      points: [
        {
          value: 100,
          unit: "g",
          expandedUncertainty: 0.02,
          uncertaintyUnit: "unidade-desconhecida",
          coverageFactor: 2,
        },
      ],
      atDate: AT_DATE,
    });
    expect(result.status).toBe("NOT_EVALUATED");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ kind: "not_evaluated" });
    expect(result.findings[0]?.message).toContain("Verifique manualmente");
  });

  it("keeps PASS when other points pass, with the partial-coverage finding attached", () => {
    const result = evaluateScopeCompliance({
      scopeLines: [massLine],
      points: [
        point({ expandedUncertainty: 0.02 }),
        {
          value: 200,
          unit: "g",
          expandedUncertainty: 0.02,
          uncertaintyUnit: "unidade-desconhecida",
          coverageFactor: 2,
        },
      ],
      atDate: AT_DATE,
    });
    expect(result.status).toBe("PASS");
    expect(result.pointsEvaluated).toBe(1);
    expect(
      result.findings.filter((f) => f.kind === "not_evaluated"),
    ).toHaveLength(1);
  });
});
