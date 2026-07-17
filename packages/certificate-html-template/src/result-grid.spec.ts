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

describe("phase-split grids + calc-input column exclusion (calibration follow-up)", () => {
  const taggedExemploShaped = {
    methodSnapshot: {
      dataFields: [
        {
          key: "pontos_indicacao",
          label: "Resultados de indicação",
          type: "table",
          columns: [
            { key: "valor_padrao", label: "Valor convencional", unit: "g" },
            // calc inputs the certificate must not print (opt-out flag)
            { key: "erro_maximo_pesos", label: "Erro máximo dos pesos", unit: "g", includeInCertificate: false },
            { key: "antes_leitura_1", label: "Leitura 1", unit: "g", phase: "before" },
            { key: "apos_leitura_1", label: "Leitura 1", unit: "g", phase: "after" },
          ],
        },
      ],
      formulas: [
        {
          outputKey: "media_indicacao_antes",
          label: "Média",
          unit: "g",
          scope: { kind: "table_row", tableKey: "pontos_indicacao" },
          reporting: { role: "primary_result", group: "calibration_result", includeInCertificate: true, phase: "before" },
        },
        {
          outputKey: "incerteza_expandida_antes",
          label: "Incerteza expandida",
          unit: "g",
          scope: { kind: "table_row", tableKey: "pontos_indicacao" },
          reporting: { role: "expanded_uncertainty", group: "calibration_result", includeInCertificate: true, phase: "before" },
        },
        {
          outputKey: "media_indicacao_apos",
          label: "Média",
          unit: "g",
          scope: { kind: "table_row", tableKey: "pontos_indicacao" },
          reporting: { role: "primary_result", group: "calibration_result", includeInCertificate: true, phase: "after" },
        },
      ],
    },
    data: {
      pontos_indicacao: [
        {
          valor_padrao: 100,
          erro_maximo_pesos: 0.005,
          antes_leitura_1: 100.001,
          apos_leitura_1: 100.0,
        },
      ],
    },
    results: {
      media_indicacao_antes: [100.001],
      incerteza_expandida_antes: [0.002],
      media_indicacao_apos: [100.0],
    },
  };

  it("phase-tagged formulas split into como-recebido / após-ajuste tables", () => {
    const grids = deriveResultGrids(taggedExemploShaped);
    expect(grids).toHaveLength(2);
    const [antes, apos] = grids;
    expect(antes?.phase).toBe("before");
    expect(antes?.title).toBe("Resultados de indicação — antes do ajuste");
    expect(antes?.columns.map((column) => column.key)).toEqual([
      "valor_padrao",
      "antes_leitura_1",
      "media_indicacao_antes",
      "incerteza_expandida_antes",
    ]);
    expect(apos?.phase).toBe("after");
    expect(apos?.columns.map((column) => column.key)).toEqual([
      "valor_padrao",
      "apos_leitura_1",
      "media_indicacao_apos",
    ]);
    // rows align per grid
    expect(antes?.rows[0]).toEqual([100, 100.001, 100.001, 0.002]);
    expect(apos?.rows[0]).toEqual([100, 100.0, 100.0]);
  });

  it("columns with includeInCertificate=false never print", () => {
    const grids = deriveResultGrids(taggedExemploShaped);
    for (const grid of grids) {
      expect(grid.columns.map((column) => column.key)).not.toContain(
        "erro_maximo_pesos",
      );
    }
  });

  it("untagged methods keep the single wide grid (phase null)", () => {
    const untagged = JSON.parse(JSON.stringify(taggedExemploShaped));
    for (const formula of untagged.methodSnapshot.formulas) {
      delete formula.reporting.phase;
    }
    const grids = deriveResultGrids(untagged);
    expect(grids).toHaveLength(1);
    expect(grids[0]?.phase).toBeNull();
  });

  it("hiddenColumns still applies inside split grids", () => {
    const grids = deriveResultGrids(taggedExemploShaped, {
      hiddenColumns: ["incerteza_expandida_antes"],
    });
    const antes = grids.find((grid) => grid.phase === "before");
    expect(antes?.columns.map((column) => column.key)).not.toContain(
      "incerteza_expandida_antes",
    );
  });
});
