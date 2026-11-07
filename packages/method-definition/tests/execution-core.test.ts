import { describe, expect, it } from "vitest";

import {
  buildCalibrationLocationSnapshot,
  buildCalibrationPhaseSnapshot,
  buildOfficialExecutionInputs,
  buildOfficialExecutionResults,
  COMPILED_EXECUTION_KEY,
  createMethodExecutionEngine,
  isCalibrationLocationSnapshot,
  isCalibrationPhaseSnapshot,
  runOfficialExecution,
  compileMethodDraft,
  fingerprintJson,
  type MethodDraft,
} from "../src";

describe("calibration location and phase snapshots", () => {
  it("records the location trimmed, stamped with who and when", () => {
    const snapshot = buildCalibrationLocationSnapshot(
      { type: "lab", addressText: "  Rua A, 1 ", notes: "  portaria  " },
      undefined,
      "user-1",
    );
    expect(snapshot).toMatchObject({
      type: "lab",
      addressText: "Rua A, 1",
      notes: "portaria",
      recordedBy: "user-1",
    });
    expect(snapshot?.recordedAt).toEqual(expect.any(String));
  });

  it("keeps the existing location when the caller sends none", () => {
    const existing = {
      type: "other" as const,
      addressText: "X",
      recordedAt: "2026-01-01T00:00:00.000Z",
      recordedBy: "u",
    };
    expect(buildCalibrationLocationSnapshot(undefined, existing, "me")).toBe(
      existing,
    );
    expect(buildCalibrationLocationSnapshot(undefined, null, "me")).toBe(
      undefined,
    );
  });

  it("records only blocks with a key and a known mode, trimming reasons", () => {
    const snapshot = buildCalibrationPhaseSnapshot(
      {
        blocks: {
          a: { mode: "not_performed", reason: "  sem acesso " },
          " ": { mode: "before_only" },
          b: { mode: "before_and_after", reason: "  " },
        },
      },
      undefined,
      "user-1",
    );
    expect(snapshot?.blocks).toEqual({
      a: { mode: "not_performed", reason: "sem acesso" },
      b: { mode: "before_and_after" },
    });
    expect(snapshot?.recordedBy).toBe("user-1");
  });

  it("tells stored snapshots from anything else", () => {
    const stamp = { recordedAt: "2026-01-01T00:00:00.000Z", recordedBy: "u" };
    expect(
      isCalibrationLocationSnapshot({
        type: "lab",
        addressText: "A",
        ...stamp,
      }),
    ).toBe(true);
    expect(
      isCalibrationLocationSnapshot({
        type: "moon",
        addressText: "A",
        ...stamp,
      }),
    ).toBe(false);
    expect(
      isCalibrationPhaseSnapshot({
        blocks: { a: { mode: "after_only" } },
        ...stamp,
      }),
    ).toBe(true);
    expect(
      isCalibrationPhaseSnapshot({ blocks: { a: { mode: "x" } }, ...stamp }),
    ).toBe(false);
    expect(isCalibrationPhaseSnapshot(null)).toBe(false);
  });
});

describe("official execution inputs", () => {
  it("binds asset specifications, the environment and the standards in grams", () => {
    const inputs = buildOfficialExecutionInputs({
      data: { indication: "10" },
      dataFields: [
        { key: "nominal", source: "asset_spec", assetSpecKey: "capacity" },
        { key: "missing", source: "asset_spec", assetSpecKey: "nope" },
        { key: "typed", source: "input" },
        null,
      ],
      assetSpecifications: { capacity: 200 },
      environmental: {
        temperature: 20,
        humidity: 50,
        pressure: 1013,
        recordedBy: "ignored",
      },
      standards: [
        {
          uncertainty: 1,
          uncertaintyUnit: "mg",
          drift: null,
          certifiedValues: [{ value: 1, uncertainty: 1, unit: "kg" }],
        },
      ],
    });
    expect(inputs).toMatchObject({
      indication: "10",
      nominal: 200,
      environment: { temperature: 20, humidity: 50, pressure: 1013 },
      standards: [{ certifiedValues: [{ value: 1000, unit: "g" }] }],
    });
    expect(inputs).not.toHaveProperty("missing");
    expect(inputs.environment).not.toHaveProperty("recordedBy");
  });

  it("leaves standards out when never frozen and empty when frozen as none", () => {
    expect(buildOfficialExecutionInputs({ data: {} })).not.toHaveProperty(
      "standards",
    );
    expect(
      buildOfficialExecutionInputs({ data: {}, standards: null }),
    ).toHaveProperty("standards", []);
  });
});

describe("official execution results", () => {
  const draft: MethodDraft = {
    id: "mass_error",
    version: 1,
    status: "published",
    name: "Mass error",
    inputs: [
      { kind: "scalar", key: "indication", label: "I", required: true },
      { kind: "scalar", key: "reference", label: "R", required: true },
    ],
    formulas: [
      {
        key: "error",
        label: "Error",
        expression: "indication - reference",
        outputKind: "error",
        required: true,
      },
    ],
    measurementModels: [],
    acceptanceCriteria: [],
    previewScenarios: [],
  };

  it("runs the method and stores its outputs next to the engine envelope", () => {
    const engine = createMethodExecutionEngine();
    const compiled = compileMethodDraft(draft, { engine });
    if (!compiled.ok) throw new Error("compile failed");

    const { execution, results } = runOfficialExecution(compiled.method, {
      data: { indication: "10.03", reference: "10" },
    });

    expect(execution.ok).toBe(true);
    expect(results.error).toBe("0.03");
    expect(results[COMPILED_EXECUTION_KEY]).toMatchObject({
      methodFingerprint: execution.methodFingerprint,
      resultFingerprint: execution.resultFingerprint,
      canonicalResultJson: execution.canonicalResultJson,
    });
    expect(results).toEqual(buildOfficialExecutionResults(execution));
    expect(Object.keys(results).at(-1)).toBe(COMPILED_EXECUTION_KEY);
    expect(fingerprintJson(results, "x")).toEqual(
      fingerprintJson(buildOfficialExecutionResults(execution), "x"),
    );
  });
});
