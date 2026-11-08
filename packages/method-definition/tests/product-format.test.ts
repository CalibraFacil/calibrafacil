import { describe, expect, it } from "vitest";
import { productFormatToMethodDraft } from "../src";

/**
 * The product format (what the method editor saves) -> the draft the compiler
 * reads. Before this was one function, the API and the template catalogue each
 * had a copy and each lost something the other kept.
 */
const stored = {
  id: 12,
  name: "Balança",
  version: 2,
  status: "DRAFT",
  dataFields: [
    {
      key: "points",
      label: "Pontos",
      type: "table",
      columns: [
        { key: "nominal", label: "Nominal", type: "number" },
        {
          key: "certified",
          label: "Valor certificado",
          type: "number",
          role: "standard_value",
          standardValue: {
            matchBy: "nominal",
            targetColumns: {
              value: "certified",
              expandedUncertainty: "u_ref",
              coverageFactor: "k_ref",
              drift: "drift",
              stray: "dropped",
            },
          },
        },
        {
          key: "mass",
          label: "Massa",
          type: "number",
          role: "mass_standard_composition",
          massComposition: {
            optionSource: "certified_values",
            uncertaintyMode: "expanded_arithmetic",
            quantityMode: "profile_linear",
          },
        },
      ],
    },
    { key: "mode", label: "Modo", type: "select", options: ["a", "b"] },
  ],
  formulas: [
    {
      outputKey: "verdict",
      expression: "1",
      reporting: { role: "conformity_verdict", group: "calibration_result" },
    },
  ],
  validations: [
    { expression: "nominal > 0", message: "Positivo" },
    { message: "sem expressão" },
  ],
};

describe("productFormatToMethodDraft", () => {
  const draft = productFormatToMethodDraft(stored);
  const table = draft.inputs.find((input) => input.kind === "table");

  it("keeps the per-row standard-value binding of a table column", () => {
    const column = table?.columns.find((entry) => entry.key === "certified");
    expect(column?.role).toBe("standard_value");
    expect(column?.standardValue).toEqual({
      matchBy: "nominal",
      targetColumns: {
        value: "certified",
        expandedUncertainty: "u_ref",
        coverageFactor: "k_ref",
        drift: "drift",
      },
    });
  });

  it("keeps the mass-composition options of the vocabulary", () => {
    const column = table?.columns.find((entry) => entry.key === "mass");
    expect(column?.massComposition).toEqual({
      optionSource: "certified_values",
      uncertaintyMode: "expanded_arithmetic",
      quantityMode: "profile_linear",
    });
  });

  it("keeps every reporting role of the vocabulary, the verdict included", () => {
    expect(draft.formulas[0]?.reporting).toEqual({
      role: "conformity_verdict",
      group: "calibration_result",
    });
  });

  it("converts a select field and drops a validation that has no expression", () => {
    expect(draft.inputs.find((input) => input.kind === "select")).toMatchObject(
      { key: "mode", options: ["a", "b"] },
    );
    expect(draft.acceptanceCriteria.map((c) => c.expression)).toEqual([
      "nominal > 0",
    ]);
  });

  it("names the draft by a safe id and maps the stored status", () => {
    expect(draft.id).toBe("method_12");
    expect(draft.status).toBe("draft");
  });
});
