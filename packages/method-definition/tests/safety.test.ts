import { describe, expect, it } from "vitest";
import { assertSafeUnknown, fingerprintJson, parseMethodDraft } from "../src";

/**
 * A draft shaped like the one the API builds in-process from a stored method
 * (`methodInputToDefinitionInput` in `apps/api/src/routes/methods.ts`): optional
 * fields are written as `field: cond ? value : undefined`, so the key exists and
 * holds `undefined` instead of being absent.
 */
function draftWithExplicitUndefined() {
  return {
    id: "balanca_analitica",
    version: 1,
    status: "draft",
    name: "Calibração de Balança Analítica",
    description: undefined,
    assetTypeId: undefined,
    inputs: [
      {
        kind: "scalar",
        key: "valor_padrao",
        label: "Valor padrão",
        unit: "g",
        required: true,
        defaultValue: undefined,
        quantityKind: "other",
      },
    ],
    formulas: [],
    measurementModels: [],
    acceptanceCriteria: [],
    previewScenarios: [],
    metadata: {},
  };
}

function draftWithAbsentKeys() {
  return {
    id: "balanca_analitica",
    version: 1,
    status: "draft",
    name: "Calibração de Balança Analítica",
    inputs: [
      {
        kind: "scalar",
        key: "valor_padrao",
        label: "Valor padrão",
        unit: "g",
        required: true,
        quantityKind: "other",
      },
    ],
    formulas: [],
    measurementModels: [],
    acceptanceCriteria: [],
    previewScenarios: [],
    metadata: {},
  };
}

describe("assertSafeUnknown", () => {
  it("treats an own key holding `undefined` as an absent key", () => {
    expect(() =>
      assertSafeUnknown({ unit: "g", defaultValue: undefined }),
    ).not.toThrow();
  });

  it("still rejects `undefined` inside an array, where JSON turns it into null", () => {
    expect(() => assertSafeUnknown({ options: ["a", undefined] })).toThrow(
      /draft\.options\[1\] has unsupported type undefined/,
    );
  });

  it("still rejects a bare `undefined` value", () => {
    expect(() => assertSafeUnknown(undefined)).toThrow(
      /draft has unsupported type undefined/,
    );
  });

  it("still rejects functions, symbols, bigints and dangerous keys", () => {
    expect(() => assertSafeUnknown({ fn: () => 1 })).toThrow(/function/);
    expect(() => assertSafeUnknown({ sym: Symbol("s") })).toThrow(/symbol/);
    expect(() => assertSafeUnknown({ big: 1n })).toThrow(/bigint/);
    expect(() =>
      assertSafeUnknown(JSON.parse('{"__proto__": {"polluted": true}}')),
    ).toThrow(/is not allowed/);
  });
});

describe("parseMethodDraft", () => {
  /**
   * REGRESSION: the Method Builder's "Compilar" action returned
   * METHOD_SHAPE_INVALID — "draft.inputs[0].defaultValue has unsupported type
   * undefined" — for any input without a default value, because the API's draft
   * mapper sets absent optional fields to an explicit `undefined` and the
   * payload never passes through JSON on that path.
   */
  it("accepts optional fields written as an explicit `undefined`", () => {
    expect(() => parseMethodDraft(draftWithExplicitUndefined())).not.toThrow();
  });

  it("normalizes explicit `undefined` and absent keys to the same fingerprint", () => {
    const fromUndefined = parseMethodDraft(draftWithExplicitUndefined());
    const fromAbsent = parseMethodDraft(draftWithAbsentKeys());

    expect(fingerprintJson(fromUndefined)).toBe(fingerprintJson(fromAbsent));
  });
});
