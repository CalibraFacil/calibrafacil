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
