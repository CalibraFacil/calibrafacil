/**
 * Characterization / coverage tests for `buildDraftFromProduct`.
 *
 * Fixture used: the **force-indication** platform template
 * (`packages/method-templates/src/templates/force-indication.ts`).
 * That template is the simplest fully-representative template: it has a
 * single table field with multiple numeric columns (including a `standard_value`
 * role column), 10 formulas with per-row scope and various `reporting` shapes,
 * and no validations (empty array) — so the "absent optional section" branch
 * (REQ-P2D-006) is also exercised. All inline inputs are used directly, NOT the
 * parsed `TemplateProductDefinition`, so the tests are independent of
 * `MethodInputFieldSchema.array().parse()` and talk straight to
 * `buildDraftFromProduct` just as the template's own `buildDraft` does.
 *
 * REQ mapping:
 *   REQ-P2D-001 → "sanitized method id" describe block
 *   REQ-P2D-002 → "field mapping" describe block
 *   REQ-P2D-003 → "formula mapping" describe block
 *   REQ-P2D-004 → "acceptance criteria / validations" describe block
 *   REQ-P2D-005 → "no undefined-valued keys" describe block
 *   REQ-P2D-006 → "absent optional sections" describe block
 */

import type {
  MethodAcceptanceCriterion,
  MethodDraft,
  TableInput,
} from "@calibra-facil/method-definition";
import { describe, expect, it } from "vitest";

import { buildDraftFromProduct } from "./product-to-draft";
import type { ProductDraftSource } from "./product-to-draft";

// ---------------------------------------------------------------------------
// Type-guard helpers (no `as` assertions — banned repo-wide)
// ---------------------------------------------------------------------------

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected a plain object, got ${typeof value}`);
  }
  return Object.fromEntries(Object.entries(value));
}

/** Returns the input at index i as a TableInput, or throws with a diagnostic. */
function getTableInput(draft: MethodDraft, index: number): TableInput {
  const inp = draft.inputs[index];
  if (!inp) throw new Error(`No input at index ${index}`);
  if (inp.kind !== "table") {
    throw new Error(
      `Input at index ${index} has kind "${inp.kind}", expected "table"`,
    );
  }
  return inp;
}

/** Requires a value is non-undefined; throws with a diagnostic path otherwise. */
function requireDefined<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`${name} was undefined`);
  return value;
}

/** Recursively verify that no value in an object tree is `undefined`. */
function assertNoUndefined(value: unknown, path = ""): void {
  if (value === undefined) {
    throw new Error(`Found undefined at path "${path || "(root)"}"`);
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      assertNoUndefined(value[i], `${path}[${i}]`);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      assertNoUndefined(item, path ? `${path}.${key}` : key);
    }
  }
}

// ---------------------------------------------------------------------------
// Force-indication product-format inputs (verbatim from the template file,
// so the fixture is a REAL registered product definition, not invented data).
// These are the raw pre-parse forms that the template passes to
// buildDraftFromProduct.
// ---------------------------------------------------------------------------

const ROW_SCOPE = { kind: "table_row", tableKey: "pontos_forca" } as const;

const forceColumns = [
  {
    key: "valor_referencia",
    label: "Força de referência (valor convencional)",
    type: "number",
    unit: "N",
    quantityKind: "reference",
    role: "standard_value",
    standardValue: {
      matchBy: "nominal",
      targetColumns: {
        value: "valor_referencia",
        expandedUncertainty: "incerteza_referencia",
        coverageFactor: "k_referencia",
      },
    },
  },
  {
    key: "incerteza_referencia",
    label: "Incerteza expandida do padrão (U)",
    type: "number",
    unit: "N",
    quantityKind: "uncertainty",
  },
  {
    key: "k_referencia",
    label: "Fator k do certificado do padrão",
    type: "number",
    quantityKind: "other",
  },
  {
    key: "resolucao",
    label: "Resolução do instrumento",
    type: "number",
    unit: "N",
    quantityKind: "resolution",
  },
  {
    key: "u_deriva",
    label: "Incerteza de deriva de sensibilidade (u_drift)",
    type: "number",
    unit: "N",
    quantityKind: "uncertainty",
  },
  {
    key: "u_temperatura",
    label: "Incerteza por efeito de temperatura (u_TCS)",
    type: "number",
    unit: "N",
    quantityKind: "uncertainty",
  },
  {
    key: "leitura_1",
    label: "Leitura 1",
    type: "number",
    unit: "N",
    quantityKind: "indication",
  },
  {
    key: "leitura_2",
    label: "Leitura 2",
    type: "number",
    unit: "N",
    quantityKind: "indication",
  },
  {
    key: "leitura_3",
    label: "Leitura 3",
    type: "number",
    unit: "N",
    quantityKind: "indication",
  },
];

const forceDataFields = [
  {
    key: "pontos_forca",
    label: "Pontos de calibração de força",
    type: "table",
    required: true,
    columns: forceColumns,
  },
];

const forceFormulas = [
  {
    outputKey: "media",
    label: "Indicação média",
    expression: "(leitura_1 + leitura_2 + leitura_3) / 3",
    scope: ROW_SCOPE,
    unit: "N",
    reporting: { role: "auxiliary", group: "raw_calculation" },
  },
  {
    outputKey: "erro",
    label: "Erro de indicação (E)",
    expression: "media - valor_referencia",
    scope: ROW_SCOPE,
    unit: "N",
    reporting: {
      includeInCertificate: true,
      role: "primary_result",
      group: "calibration_result",
    },
  },
  {
    outputKey: "desvio_padrao",
    label: "Desvio-padrão experimental",
    expression:
      "sqrt(((leitura_1 - media) ^ 2 + (leitura_2 - media) ^ 2 + (leitura_3 - media) ^ 2) / 2)",
    scope: ROW_SCOPE,
    unit: "N",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_repetibilidade",
    label: "Incerteza de repetibilidade (Tipo A)",
    expression: "desvio_padrao / sqrt(3)",
    scope: ROW_SCOPE,
    unit: "N",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_resolucao",
    label: "Incerteza da resolução",
    expression: "resolucao / sqrt(6)",
    scope: ROW_SCOPE,
    unit: "N",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_referencia",
    label: "Incerteza do padrão de referência",
    expression: "incerteza_referencia / k_referencia",
    scope: ROW_SCOPE,
    unit: "N",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_combinada",
    label: "Incerteza-padrão combinada",
    expression:
      "sqrt(u_repetibilidade ^ 2 + u_resolucao ^ 2 + u_referencia ^ 2 + u_deriva ^ 2 + u_temperatura ^ 2)",
    scope: ROW_SCOPE,
    unit: "N",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "veff",
    label: "Graus de liberdade efetivos (Welch–Satterthwaite)",
    expression:
      "if_zero(u_repetibilidade, 1000000000, (u_combinada ^ 4) / ((u_repetibilidade ^ 4) / 2))",
    scope: ROW_SCOPE,
    reporting: { role: "auxiliary", group: "uncertainty_budget" },
  },
  {
    outputKey: "fator_k",
    label: "Fator de abrangência (k)",
    expression:
      "if_zero(u_repetibilidade, 2, student_t_inverse_2t(0.0455, veff))",
    scope: ROW_SCOPE,
    reporting: {
      includeInCertificate: true,
      role: "coverage_factor",
      group: "calibration_result",
    },
  },
  {
    outputKey: "u_expandida",
    label: "Incerteza expandida (U)",
    expression: "fator_k * u_combinada",
    scope: ROW_SCOPE,
    unit: "N",
    reporting: {
      includeInCertificate: true,
      role: "expanded_uncertainty",
      group: "calibration_result",
    },
  },
];

const FORCE_SOURCE = {
  name: "Calibração de Força por Erro de Indicação",
  description: "Método de calibração de força para dinamômetros.",
  assetTypeId: "dinamometro",
  dataFields: forceDataFields,
  formulas: forceFormulas,
  validations: [],
  metadata: {
    validationStatus: "pending_revalidation",
    source: "method-templates:force-indication",
  },
} satisfies ProductDraftSource;

// ---------------------------------------------------------------------------
// REQ-P2D-001: sanitized method id
// ---------------------------------------------------------------------------

describe("REQ-P2D-001: sanitized method id via safeMethodId", () => {
  it("REQ-P2D-001: id starts with a letter when name is the source", () => {
    // REQ-P2D-001: WHEN buildDraftFromProduct receives a minimal valid product
    // source, the function SHALL return a draft whose method id is sanitized
    // via safeMethodId (starts with a letter; only [A-Za-z0-9_]).
    const draft = buildDraftFromProduct(FORCE_SOURCE);
    expect(typeof draft.id).toBe("string");
    // Must start with a letter
    expect(/^[a-zA-Z]/.test(draft.id)).toBe(true);
    // Must contain only [A-Za-z0-9_]
    expect(/^[A-Za-z0-9_]+$/.test(draft.id)).toBe(true);
  });

  it("REQ-P2D-001: explicit numeric methodId is sanitized (digit-start → method_ prefix)", () => {
    // When args.methodId is a number like 6, safeMethodId("6") → "method_6"
    const draft = buildDraftFromProduct(FORCE_SOURCE, { methodId: 6 });
    expect(draft.id).toBe("method_6");
    expect(/^[a-zA-Z]/.test(draft.id)).toBe(true);
  });

  it("REQ-P2D-001: name with hyphens is sanitized to underscores", () => {
    const source = {
      ...FORCE_SOURCE,
      name: "method-with-hyphens",
    } satisfies ProductDraftSource;
    const draft = buildDraftFromProduct(source);
    // "method-with-hyphens" → "method_with_hyphens"
    expect(draft.id).toBe("method_with_hyphens");
    expect(/^[a-zA-Z]/.test(draft.id)).toBe(true);
    expect(/^[A-Za-z0-9_]+$/.test(draft.id)).toBe(true);
  });

  it("REQ-P2D-001: name starting with a digit gets method_ prefix", () => {
    const source = {
      ...FORCE_SOURCE,
      name: "123-numeric-start",
    } satisfies ProductDraftSource;
    const draft = buildDraftFromProduct(source);
    // "123-numeric-start" → "123_numeric_start" → prefixed → "method_123_numeric_start"
    expect(draft.id).toBe("method_123_numeric_start");
    expect(/^[a-zA-Z]/.test(draft.id)).toBe(true);
  });

  it("REQ-P2D-001: string methodId that is already clean passes through unchanged", () => {
    const draft = buildDraftFromProduct(FORCE_SOURCE, {
      methodId: "forceV2",
    });
    expect(draft.id).toBe("forceV2");
  });
});

// ---------------------------------------------------------------------------
// REQ-P2D-002: field mapping — field keys and types are preserved
// ---------------------------------------------------------------------------

describe("REQ-P2D-002: field mapping — keys and types preserved", () => {
  const draft = buildDraftFromProduct(FORCE_SOURCE, { methodId: 1 });

  it("REQ-P2D-002: the table field key is preserved as the first draft input", () => {
    // The single data field "pontos_forca" (type:table) must produce a draft
    // input with kind:"table" and the same key.
    const tableInput = getTableInput(draft, 0);
    expect(tableInput.kind).toBe("table");
    expect(tableInput.key).toBe("pontos_forca");
  });

  it("REQ-P2D-002: table input label is preserved", () => {
    const tableInput = getTableInput(draft, 0);
    expect(tableInput.label).toBe("Pontos de calibração de força");
  });

  it("REQ-P2D-002: table input columns are all mapped (9 numeric columns)", () => {
    // All 9 columns from forceColumns must be present (all have type:"number",
    // none are dropped — all have key+label)
    const tableInput = getTableInput(draft, 0);
    expect(tableInput.columns).toHaveLength(forceColumns.length);
  });

  it("REQ-P2D-002: column keys are preserved verbatim", () => {
    const tableInput = getTableInput(draft, 0);
    const columnKeys = tableInput.columns.map((col) => col.key);
    const expectedKeys = forceColumns.map((col) => col.key);
    expect(columnKeys).toEqual(expectedKeys);
  });

  it("REQ-P2D-002: column labels are preserved verbatim", () => {
    const tableInput = getTableInput(draft, 0);
    for (let i = 0; i < forceColumns.length; i++) {
      const col = tableInput.columns[i];
      const expectedLabel = forceColumns[i]?.label;
      expect(requireDefined(col, `column[${i}]`).label).toBe(expectedLabel);
    }
  });

  it("REQ-P2D-002: all numeric column types are mapped to 'number'", () => {
    const tableInput = getTableInput(draft, 0);
    for (const col of tableInput.columns) {
      expect(col.type).toBe("number");
    }
  });

  it("REQ-P2D-002: standard_value role is preserved on valor_referencia column", () => {
    const tableInput = getTableInput(draft, 0);
    const valRefCol = tableInput.columns.find(
      (col) => col.key === "valor_referencia",
    );
    expect(requireDefined(valRefCol, "valor_referencia column").role).toBe(
      "standard_value",
    );
  });

  it("REQ-P2D-002: standardValue.matchBy is preserved on valor_referencia column", () => {
    const tableInput = getTableInput(draft, 0);
    const valRefCol = tableInput.columns.find(
      (col) => col.key === "valor_referencia",
    );
    expect(
      requireDefined(valRefCol, "valor_referencia column").standardValue
        ?.matchBy,
    ).toBe("nominal");
  });

  it("REQ-P2D-002: variable-binding scalar inputs are produced after the main field", () => {
    // buildDraftFromProduct generates variable bindings from numeric columns.
    // The draft inputs should contain more entries than just the table input.
    expect(draft.inputs.length).toBeGreaterThan(1);
    // All entries after index 0 should be scalars (kind:"scalar")
    for (const input of draft.inputs.slice(1)) {
      expect(input.kind).toBe("scalar");
    }
  });

  it("REQ-P2D-002: environment bindings are appended (env_temperature, env_humidity, env_pressure)", () => {
    const keys = draft.inputs.map((inp) => inp.key);
    expect(keys).toContain("env_temperature");
    expect(keys).toContain("env_humidity");
    expect(keys).toContain("env_pressure");
  });
});

// ---------------------------------------------------------------------------
// REQ-P2D-003: formula mapping — identifiers (keys) are carried intact
// ---------------------------------------------------------------------------

describe("REQ-P2D-003: formula mapping — identifiers preserved", () => {
  const draft = buildDraftFromProduct(FORCE_SOURCE, { methodId: 1 });

  it("REQ-P2D-003: formula count matches the product definition", () => {
    // REQ-P2D-003: WHEN the product defines formulas/derived quantities, the
    // function SHALL carry them into the draft's formula list with their
    // identifiers intact.
    expect(draft.formulas).toHaveLength(forceFormulas.length);
  });

  it("REQ-P2D-003: formula keys come from outputKey (the primary identifier field)", () => {
    // methodFormulaToDefinitionFormula uses outputKey → key in the draft
    const draftKeys = draft.formulas.map((f) => f.key);
    const expectedKeys = forceFormulas.map((f) => f.outputKey);
    expect(draftKeys).toEqual(expectedKeys);
  });

  it("REQ-P2D-003: formula labels are preserved", () => {
    for (let i = 0; i < forceFormulas.length; i++) {
      const formula = draft.formulas[i];
      const expected = forceFormulas[i]?.label;
      expect(requireDefined(formula, `formula[${i}]`).label).toBe(expected);
    }
  });

  it("REQ-P2D-003: formula expressions are preserved verbatim", () => {
    for (let i = 0; i < forceFormulas.length; i++) {
      const formula = draft.formulas[i];
      const expected = forceFormulas[i]?.expression;
      expect(requireDefined(formula, `formula[${i}]`).expression).toBe(
        expected,
      );
    }
  });

  it("REQ-P2D-003: scope (table_row) is carried through for row-scoped formulas", () => {
    // All force formulas have a ROW_SCOPE; verify the first as representative.
    const firstFormula = requireDefined(draft.formulas[0], "formula[0]");
    const scope = requireDefined(firstFormula.scope, "formula[0].scope");
    expect(scope.kind).toBe("table_row");
    if (scope.kind !== "table_row") return;
    expect(scope.tableKey).toBe("pontos_forca");
  });

  it("REQ-P2D-003: reporting.role is preserved for a primary_result formula", () => {
    const erroFormula = requireDefined(
      draft.formulas.find((f) => f.key === "erro"),
      "erro formula",
    );
    expect(erroFormula.reporting?.role).toBe("primary_result");
  });

  it("REQ-P2D-003: reporting.includeInCertificate is preserved where set", () => {
    const erroFormula = requireDefined(
      draft.formulas.find((f) => f.key === "erro"),
      "erro formula",
    );
    expect(erroFormula.reporting?.includeInCertificate).toBe(true);
  });

  it("REQ-P2D-003: reporting.group is preserved (calibration_result)", () => {
    const erroFormula = requireDefined(
      draft.formulas.find((f) => f.key === "erro"),
      "erro formula",
    );
    expect(erroFormula.reporting?.group).toBe("calibration_result");
  });

  it("REQ-P2D-003: reporting.role is preserved for coverage_factor formula", () => {
    const kFormula = requireDefined(
      draft.formulas.find((f) => f.key === "fator_k"),
      "fator_k formula",
    );
    expect(kFormula.reporting?.role).toBe("coverage_factor");
  });

  it("REQ-P2D-003: reporting.role is preserved for expanded_uncertainty formula", () => {
    const uFormula = requireDefined(
      draft.formulas.find((f) => f.key === "u_expandida"),
      "u_expandida formula",
    );
    expect(uFormula.reporting?.role).toBe("expanded_uncertainty");
  });

  it("REQ-P2D-003: unit is carried through where provided (N)", () => {
    const erroFormula = requireDefined(
      draft.formulas.find((f) => f.key === "erro"),
      "erro formula",
    );
    expect(erroFormula.outputUnit).toBe("N");
  });

  it("REQ-P2D-003: all draft formulas have outputKind set to derived_quantity", () => {
    // methodFormulaToDefinitionFormula always sets outputKind:"derived_quantity"
    for (const formula of draft.formulas) {
      expect(formula.outputKind).toBe("derived_quantity");
    }
  });
});

// ---------------------------------------------------------------------------
// REQ-P2D-004: acceptance criteria / validations are included
// ---------------------------------------------------------------------------

describe("REQ-P2D-004: acceptance criteria / validations included", () => {
  it("REQ-P2D-004: empty validations produce empty acceptanceCriteria array", () => {
    // REQ-P2D-004: WHEN the product defines acceptance criteria / validations,
    // the function SHALL include them in the draft (count + key fields preserved).
    // The force template uses [] so this confirms the mapping works with 0 items.
    const draft = buildDraftFromProduct(FORCE_SOURCE);
    expect(draft.acceptanceCriteria).toEqual([]);
  });

  it("REQ-P2D-004: non-empty validations are mapped to acceptance criteria with correct count", () => {
    const sourceWithValidations = {
      ...FORCE_SOURCE,
      validations: [
        {
          expression: "erro < u_expandida",
          message: "Erro dentro da incerteza expandida",
          severity: "blocking",
        },
        {
          message: "Fator k deve ser positivo",
          leftExpression: "fator_k",
          operator: ">",
          rightExpression: "0",
          severity: "warning",
        },
      ],
    } satisfies ProductDraftSource;

    const draft = buildDraftFromProduct(sourceWithValidations);
    // REQ-P2D-004: count must match validations array
    expect(draft.acceptanceCriteria).toHaveLength(2);
  });

  it("REQ-P2D-004: criterion keys follow the criterion_N pattern", () => {
    const sourceWithValidations = {
      ...FORCE_SOURCE,
      validations: [
        {
          expression: "erro < u_expandida",
          message: "Erro dentro da incerteza expandida",
        },
        {
          expression: "fator_k > 0",
          message: "k positivo",
        },
      ],
    } satisfies ProductDraftSource;

    const draft = buildDraftFromProduct(sourceWithValidations);
    const crit0 = requireDefined(
      draft.acceptanceCriteria[0],
      "acceptanceCriteria[0]",
    );
    const crit1 = requireDefined(
      draft.acceptanceCriteria[1],
      "acceptanceCriteria[1]",
    );
    expect(crit0.key).toBe("criterion_1");
    expect(crit1.key).toBe("criterion_2");
  });

  it("REQ-P2D-004: message is preserved as the criterion label and message", () => {
    const sourceWithValidations = {
      ...FORCE_SOURCE,
      validations: [
        {
          expression: "erro < u_expandida",
          message: "Erro dentro da incerteza expandida",
        },
      ],
    } satisfies ProductDraftSource;

    const draft = buildDraftFromProduct(sourceWithValidations);
    const crit = requireDefined(
      draft.acceptanceCriteria[0],
      "acceptanceCriteria[0]",
    ) satisfies MethodAcceptanceCriterion;
    expect(crit.label).toBe("Erro dentro da incerteza expandida");
    expect(crit.message).toBe("Erro dentro da incerteza expandida");
  });

  it("REQ-P2D-004: expression is preserved when validation provides direct expression", () => {
    const sourceWithValidations = {
      ...FORCE_SOURCE,
      validations: [
        {
          expression: "erro < u_expandida",
          message: "Erro dentro da incerteza expandida",
        },
      ],
    } satisfies ProductDraftSource;

    const draft = buildDraftFromProduct(sourceWithValidations);
    const crit = requireDefined(
      draft.acceptanceCriteria[0],
      "acceptanceCriteria[0]",
    );
    expect(crit.expression).toBe("erro < u_expandida");
  });

  it("REQ-P2D-004: leftExpression+operator+rightExpression is assembled into expression", () => {
    const sourceWithValidations = {
      ...FORCE_SOURCE,
      validations: [
        {
          leftExpression: "fator_k",
          operator: ">",
          rightExpression: "0",
          message: "k positivo",
        },
      ],
    } satisfies ProductDraftSource;

    const draft = buildDraftFromProduct(sourceWithValidations);
    // methodValidationToAcceptanceCriterion assembles: leftExpression operator rightExpression
    const crit = requireDefined(
      draft.acceptanceCriteria[0],
      "acceptanceCriteria[0]",
    );
    expect(crit.expression).toBe("fator_k > 0");
  });

  it("REQ-P2D-004: severity 'warning' is preserved", () => {
    const sourceWithValidations = {
      ...FORCE_SOURCE,
      validations: [
        {
          expression: "u_combinada > 0",
          message: "u_c deve ser positivo",
          severity: "warning",
        },
      ],
    } satisfies ProductDraftSource;

    const draft = buildDraftFromProduct(sourceWithValidations);
    const crit = requireDefined(
      draft.acceptanceCriteria[0],
      "acceptanceCriteria[0]",
    );
    expect(crit.severity).toBe("warning");
  });

  it("REQ-P2D-004: unknown severity defaults to 'blocking'", () => {
    const sourceWithValidations = {
      ...FORCE_SOURCE,
      validations: [
        {
          expression: "u_combinada > 0",
          message: "u_c deve ser positivo",
          // severity omitted → defaults to blocking
        },
      ],
    } satisfies ProductDraftSource;

    const draft = buildDraftFromProduct(sourceWithValidations);
    const crit = requireDefined(
      draft.acceptanceCriteria[0],
      "acceptanceCriteria[0]",
    );
    expect(crit.severity).toBe("blocking");
  });
});

// ---------------------------------------------------------------------------
// REQ-P2D-005: no undefined-valued keys in the returned draft
// ---------------------------------------------------------------------------

describe("REQ-P2D-005: no undefined-valued keys in returned draft", () => {
  it("REQ-P2D-005: force-indication draft has no undefined values (fingerprint stability)", () => {
    // REQ-P2D-005: The returned draft SHALL contain no undefined-valued keys
    // (the transform strips them via stripUndefinedDeep), so the object is
    // fingerprint-stable.
    const draft = buildDraftFromProduct(FORCE_SOURCE, {
      methodId: 1,
      version: 1,
    });
    // assertNoUndefined throws if any undefined value is found anywhere in the tree
    expect(() => assertNoUndefined(draft)).not.toThrow();
  });

  it("REQ-P2D-005: top-level required fields are present", () => {
    const draft = buildDraftFromProduct(FORCE_SOURCE, { methodId: 1 });
    expect(draft.id).toBeDefined();
    expect(draft.version).toBeDefined();
    expect(draft.status).toBeDefined();
    expect(draft.name).toBeDefined();
    expect(draft.inputs).toBeDefined();
    expect(draft.formulas).toBeDefined();
    expect(draft.measurementModels).toBeDefined();
    expect(draft.acceptanceCriteria).toBeDefined();
    expect(draft.previewScenarios).toBeDefined();
    expect(draft.metadata).toBeDefined();
  });

  it("REQ-P2D-005: optional unit is absent (not undefined) when formula has no unit", () => {
    // The 'veff' formula has no unit — the key must not exist at all, not be undefined
    const draft = buildDraftFromProduct(FORCE_SOURCE);
    const veffFormula = requireDefined(
      draft.formulas.find((f) => f.key === "veff"),
      "veff formula",
    );
    // outputUnit key must not exist on the object (stripUndefinedDeep removes it)
    expect(veffFormula).not.toHaveProperty("outputUnit");
  });

  it("REQ-P2D-005: variable binding inputs have no undefined metadata values", () => {
    const draft = buildDraftFromProduct(FORCE_SOURCE);
    // All scalar inputs after the first (the table) are variable bindings
    for (const input of draft.inputs.slice(1)) {
      expect(() => assertNoUndefined(input)).not.toThrow();
    }
  });

  it("REQ-P2D-005: no undefined in formula list items", () => {
    const draft = buildDraftFromProduct(FORCE_SOURCE);
    for (const formula of draft.formulas) {
      expect(() => assertNoUndefined(formula)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// REQ-P2D-006: absent optional sections are empty/omitted, never throw
// ---------------------------------------------------------------------------

describe("REQ-P2D-006: absent optional sections produce empty/omitted output", () => {
  it("REQ-P2D-006: missing 'validations' key does not throw and yields empty acceptanceCriteria", () => {
    // REQ-P2D-006: IF an optional product section is absent, THEN the
    // corresponding draft section SHALL be empty/omitted rather than throwing.
    const sourceWithoutValidations: ProductDraftSource = {
      name: "Minimal Force Method",
      dataFields: [],
      formulas: [],
      metadata: { validationStatus: "pending_revalidation" },
      // validations is intentionally omitted (it's optional in ProductDraftSource)
    };
    const draft = buildDraftFromProduct(sourceWithoutValidations);
    expect(draft.acceptanceCriteria).toEqual([]);
  });

  it("REQ-P2D-006: missing 'measurementModels' defaults to empty array in draft", () => {
    const sourceWithoutModels: ProductDraftSource = {
      name: "Minimal Force Method",
      dataFields: [],
      formulas: [],
      metadata: { validationStatus: "pending_revalidation" },
      // measurementModels is intentionally omitted
    };
    const draft = buildDraftFromProduct(sourceWithoutModels);
    expect(draft.measurementModels).toEqual([]);
  });

  it("REQ-P2D-006: missing 'description' does not produce undefined in draft", () => {
    const sourceWithoutDescription: ProductDraftSource = {
      name: "Force Method No Description",
      dataFields: [],
      formulas: [],
      metadata: { validationStatus: "pending_revalidation" },
    };
    const draft = buildDraftFromProduct(sourceWithoutDescription);
    // description is optional; when absent it must either be absent (not
    // undefined) or not present at all — either way no throw
    expect(() => assertNoUndefined(draft)).not.toThrow();
  });

  it("REQ-P2D-006: missing 'assetTypeId' does not throw and assetTypeId is absent in draft", () => {
    const sourceWithoutAssetType: ProductDraftSource = {
      name: "Force Method No Asset",
      dataFields: [],
      formulas: [],
      metadata: { validationStatus: "pending_revalidation" },
    };
    const draft = buildDraftFromProduct(sourceWithoutAssetType);
    // assetTypeId must be absent (not undefined) in the draft
    expect(() => assertNoUndefined(draft)).not.toThrow();
  });

  it("REQ-P2D-006: empty dataFields produces only environment variable bindings", () => {
    const minimalSource: ProductDraftSource = {
      name: "Empty Fields Method",
      dataFields: [],
      formulas: [],
      metadata: {},
    };
    const draft = buildDraftFromProduct(minimalSource);
    // With no data fields, only the 3 environment bindings remain
    expect(draft.inputs).toHaveLength(3);
    const keys = draft.inputs.map((inp) => inp.key);
    expect(keys).toContain("env_temperature");
    expect(keys).toContain("env_humidity");
    expect(keys).toContain("env_pressure");
  });

  it("REQ-P2D-006: empty formulas produces empty formula list in draft", () => {
    const minimalSource: ProductDraftSource = {
      name: "Empty Formulas Method",
      dataFields: [],
      formulas: [],
      metadata: {},
    };
    const draft = buildDraftFromProduct(minimalSource);
    expect(draft.formulas).toEqual([]);
  });

  it("REQ-P2D-006: previewScenarios is always an empty array (never a missing key)", () => {
    const draft = buildDraftFromProduct(FORCE_SOURCE);
    expect(Array.isArray(draft.previewScenarios)).toBe(true);
    expect(draft.previewScenarios).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Additional integration: status mapping and draft identity
// ---------------------------------------------------------------------------

describe("status mapping and draft identity", () => {
  it("no explicit status defaults to 'draft'", () => {
    const draft = buildDraftFromProduct(FORCE_SOURCE);
    expect(draft.status).toBe("draft");
  });

  it("status not in persisted map falls through to 'draft' (default branch)", () => {
    // mapPersistedStatus maps PERSISTED DB strings ("PENDING_APPROVAL", etc.).
    // BuildDraftArgs.status is typed as MethodDraftStatus; passing a draft-format
    // value like "ready_for_review" (not a persisted key) hits the default branch
    // and produces "draft". This test documents the mapPersistedStatus default.
    const draft = buildDraftFromProduct(FORCE_SOURCE, {
      status: "ready_for_review",
    });
    expect(draft.status).toBe("draft");
  });

  it("version defaults to 1 when not supplied", () => {
    const draft = buildDraftFromProduct(FORCE_SOURCE);
    expect(draft.version).toBe(1);
  });

  it("explicit version is preserved", () => {
    const draft = buildDraftFromProduct(FORCE_SOURCE, { version: 3 });
    expect(draft.version).toBe(3);
  });

  it("name is preserved verbatim", () => {
    const draft = buildDraftFromProduct(FORCE_SOURCE);
    expect(draft.name).toBe(FORCE_SOURCE.name);
  });

  it("metadata is preserved in the draft", () => {
    const draft = buildDraftFromProduct(FORCE_SOURCE);
    const meta = toRecord(draft.metadata);
    expect(meta["validationStatus"]).toBe("pending_revalidation");
    expect(meta["source"]).toBe("method-templates:force-indication");
  });
});

// ---------------------------------------------------------------------------
// Regression guard: mutation-check the field assertions
// (If a column is dropped from the definition, the column count assertion goes RED.)
// ---------------------------------------------------------------------------

describe("regression guard: column count locks field list (REQ-P2D-002)", () => {
  it("REQ-P2D-002: draft has exactly 9 table columns (matches forceColumns)", () => {
    const draft = buildDraftFromProduct(FORCE_SOURCE, { methodId: 1 });
    const tableInput = getTableInput(draft, 0);
    expect(tableInput.columns).toHaveLength(9);
  });
});

describe("regression guard: formula count locks formula list (REQ-P2D-003)", () => {
  it("REQ-P2D-003: draft has exactly 10 formulas (matches forceFormulas)", () => {
    const draft = buildDraftFromProduct(FORCE_SOURCE, { methodId: 1 });
    expect(draft.formulas).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
// Type-level guard: the draft returned satisfies the MethodDraft shape
// (If MethodDraft changes in an incompatible way, this fails at type-check time)
// ---------------------------------------------------------------------------

describe("type-level guard: return satisfies MethodDraft shape", () => {
  it("REQ-P2D-002/003/004: draft inputs/formulas/criteria are arrays of correct shape", () => {
    const draft = buildDraftFromProduct(FORCE_SOURCE, {
      methodId: 1,
    }) satisfies MethodDraft;
    // Inputs
    for (const input of draft.inputs) {
      expect(typeof input.key).toBe("string");
      expect(typeof input.kind).toBe("string");
    }
    // Formulas
    for (const formula of draft.formulas) {
      const rec = toRecord(formula);
      expect(typeof rec["key"]).toBe("string");
      expect(typeof rec["expression"]).toBe("string");
    }
    // acceptanceCriteria (empty for force template)
    expect(Array.isArray(draft.acceptanceCriteria)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Per-column binding: table_statistic variable bindings are generated
// (Each numeric column in a table emits 5 additional statistic bindings)
// ---------------------------------------------------------------------------

describe("variable binding generation for numeric table columns", () => {
  it("each numeric column emits mean/sample_stddev/count/min/max statistics", () => {
    // force template has 9 numeric columns; each yields 1 raw + 5 statistics = 6,
    // plus 3 env bindings. Total = 9*6 + 3 = 57 variable-binding inputs,
    // plus the table input itself = 58.
    const draft = buildDraftFromProduct(FORCE_SOURCE, { methodId: 1 });
    const expectedVarBindingCount = 9 * 6 + 3; // 9 columns × 6 bindings + 3 env
    // +1 for the table input itself
    expect(draft.inputs).toHaveLength(1 + expectedVarBindingCount);
  });

  it("statistic binding keys follow the <tableKey>_<colKey>_<statistic> pattern", () => {
    const draft = buildDraftFromProduct(FORCE_SOURCE, { methodId: 1 });
    const keys = draft.inputs.map((inp) => inp.key);
    // Check a sample of statistic bindings for the 'valor_referencia' column
    expect(keys).toContain("pontos_forca_valor_referencia_mean");
    expect(keys).toContain("pontos_forca_valor_referencia_sample_stddev");
    expect(keys).toContain("pontos_forca_valor_referencia_count");
    expect(keys).toContain("pontos_forca_valor_referencia_min");
    expect(keys).toContain("pontos_forca_valor_referencia_max");
  });
});
