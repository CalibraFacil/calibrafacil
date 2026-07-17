import { describe, expect, it } from "vitest";

import { deriveResultGrids } from "./result-grid.js";
import { sampleCertificateInputData } from "./fixtures/sample-input-data.js";

describe("deriveResultGrids (reframe T22)", () => {
  it("derives per-method columns: phase-ordered inputs then computed formulas", () => {
    const grids = deriveResultGrids(sampleCertificateInputData);
    expect(grids).toHaveLength(1);
    const grid = grids[0];
    expect(grid?.tableKey).toBe("pontos");
    expect(grid?.columns.map((column) => column.key)).toEqual([
      "nominal",
      "leitura_antes",
      "leitura_apos",
      "erro_ponto",
      "u_ponto",
      "ema_ponto",
    ]);
    // includeInCertificate: false formulas are excluded
    expect(grid?.columns.map((column) => column.key)).not.toContain(
      "debug_interno",
    );
    expect(grid?.rows).toHaveLength(4);
    expect(grid?.rows[1]).toEqual([1000, 999, 1000, 0, 0.3, 0.5]);
  });

  it("template hiddenColumns override removes input AND computed columns", () => {
    const grids = deriveResultGrids(sampleCertificateInputData, {
      hiddenColumns: ["leitura_antes", "ema_ponto"],
    });
    expect(grids[0]?.columns.map((column) => column.key)).toEqual([
      "nominal",
      "leitura_apos",
      "erro_ponto",
      "u_ponto",
    ]);
  });

  it("returns [] for scalar-only methods (fallback path)", () => {
    const scalarOnly = { methodSnapshot: { dataFields: [], formulas: [] } };
    expect(deriveResultGrids(scalarOnly)).toEqual([]);
  });
});

describe("real-certificate calibration (Exemplo FOR 50/51 ground truth)", () => {
  // Column/formula shapes copied from the REAL accredited method (dev
  // calibration_method id=6): 8 calc-input columns + 3 readings per phase,
  // and a full per-row uncertainty budget declared as table_row formulas
  // with includeInCertificate=true.
  const exemploShaped = {
    methodSnapshot: {
      dataFields: [
        {
          key: "pontos_indicacao",
          label: "Resultados de indicação",
          type: "table",
          columns: [
            { key: "valor_padrao", label: "Valor convencional", unit: "g" },
            { key: "antes_leitura_1", label: "Leitura 1", unit: "g", phase: "before" },
            { key: "apos_leitura_1", label: "Leitura 1", unit: "g", phase: "after" },
          ],
        },
      ],
      formulas: [
        {
          outputKey: "media_indicacao_antes",
          label: "Média por ponto antes do ajuste",
          unit: "g",
          scope: { kind: "table_row", tableKey: "pontos_indicacao" },
          reporting: { role: "primary_result", group: "calibration_result", includeInCertificate: true },
        },
        {
          outputKey: "incerteza_expandida_antes",
          label: "Incerteza expandida antes do ajuste",
          unit: "g",
          scope: { kind: "table_row", tableKey: "pontos_indicacao" },
          reporting: { role: "expanded_uncertainty", group: "calibration_result", includeInCertificate: true },
        },
        {
          outputKey: "fator_k_antes",
          label: "Fator de abrangência antes do ajuste",
          scope: { kind: "table_row", tableKey: "pontos_indicacao" },
          reporting: { role: "coverage_factor", group: "uncertainty_budget", includeInCertificate: true },
        },
        {
          outputKey: "veff_antes",
          label: "Graus de liberdade efetivos antes do ajuste",
          scope: { kind: "table_row", tableKey: "pontos_indicacao" },
          reporting: { role: "auxiliary", group: "uncertainty_budget", includeInCertificate: true },
        },
        {
          outputKey: "u_resolucao",
          label: "Incerteza da resolução",
          unit: "g",
          scope: { kind: "table_row", tableKey: "pontos_indicacao" },
          reporting: { role: "uncertainty_component", group: "uncertainty_budget", includeInCertificate: true },
        },
        {
          outputKey: "u_combinada_antes",
          label: "Incerteza combinada antes do ajuste",
          unit: "g",
          scope: { kind: "table_row", tableKey: "pontos_indicacao" },
          reporting: { role: "expanded_uncertainty", group: "uncertainty_budget", includeInCertificate: true },
        },
      ],
    },
    data: {
      pontos_indicacao: [
        { valor_padrao: 100, antes_leitura_1: 100.001, apos_leitura_1: 100.0 },
      ],
    },
    results: {
      media_indicacao_antes: [100.001],
      incerteza_expandida_antes: [0.002],
      fator_k_antes: [2],
      veff_antes: [120],
      u_resolucao: [0.0005],
      u_combinada_antes: [0.001],
    },
  };

  it("prints the RESULTS (média/erro/U/k/veff) and NEVER the budget internals", () => {
    const grids = deriveResultGrids(exemploShaped);
    expect(grids).toHaveLength(1);
    const keys = grids[0]?.columns.map((column) => column.key);
    expect(keys).toEqual([
      "valor_padrao",
      "antes_leitura_1",
      "apos_leitura_1",
      "media_indicacao_antes",
      "incerteza_expandida_antes",
      "fator_k_antes",
      "veff_antes",
    ]);
    expect(keys).not.toContain("u_resolucao");
    expect(keys).not.toContain("u_combinada_antes");
  });
});
