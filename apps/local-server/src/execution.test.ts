import { describe, expect, it } from "vitest";
import { compileMethodDraft, fingerprintJson } from "@calibra-facil/method-definition";
import { ENGINE_VERSION } from "@calibra-facil/math-engine";

import { executeLocalCompiledMethod } from "./execution";
import { createMethodDefinitionEngine } from "./method-engine";

/**
 * The desktop freezes a compiled method into every local job. A desktop release
 * that ships a new engine version makes those frozen copies unexecutable
 * (`ENGINE_VERSION_MISMATCH`) unless the currently published local compilation
 * of the same method is adopted in their place.
 */
function compiledMethodWithEngineVersion(version: string, name = "Mass error") {
  const engine = createMethodDefinitionEngine();
  const result = compileMethodDraft(
    {
      id: "mass_error",
      version: 1,
      status: "published",
      name,
      inputs: [
        { kind: "scalar", key: "indication", label: "Indication", required: true },
        { kind: "scalar", key: "reference", label: "Reference", required: true },
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
      previewScenarios: [
        {
          key: "nominal",
          label: "Nominal",
          inputs: { indication: "10.03", reference: "10" },
          expected: { formulas: { error: "0.03" } },
        },
      ],
    },
    {
      engine,
      engineMetadata: {
        packageName: "@calibra-facil/math-engine",
        version,
        optionsFingerprint: fingerprintJson(engine.options, "engine-options"),
      },
      requirePublishable: true,
    },
  );
  if (!result.ok) {
    throw new Error(result.diagnostics[0]?.message ?? "compile failed");
  }
  return result.method;
}

const runningVersion = ENGINE_VERSION;

function execute(params: {
  compiledMethod: unknown;
  currentCompiledMethod?: unknown;
}) {
  return executeLocalCompiledMethod({
    methodSnapshot: {
      compiledMethod: params.compiledMethod,
      dataFields: [
        { kind: "scalar", key: "indication", label: "Indication" },
        { kind: "scalar", key: "reference", label: "Reference" },
      ],
    },
    assetSnapshot: { specifications: {} },
    data: { indication: "10.03", reference: "10" },
    currentCompiledMethod: params.currentCompiledMethod,
    requireSuccess: true,
  });
}

describe("executeLocalCompiledMethod — engine reconciliation", () => {
  it("refuses a snapshot compiled under an older engine when nothing can replace it", () => {
    expect(() =>
      execute({ compiledMethod: compiledMethodWithEngineVersion("0.3.0") }),
    ).toThrowError(/motor/i);
  });

  it("adopts the currently published compilation of the same method", () => {
    const results = execute({
      compiledMethod: compiledMethodWithEngineVersion("0.3.0"),
      currentCompiledMethod: compiledMethodWithEngineVersion(runningVersion),
    });
    expect(results).not.toBeNull();
    const record: Record<string, unknown> = results ?? {};
    expect(record.__compiledExecution).toMatchObject({
      engineVersion: runningVersion,
    });
    expect(record.error).toBe("0.03");
  });

  it("does not adopt a compilation of a different method", () => {
    expect(() =>
      execute({
        compiledMethod: compiledMethodWithEngineVersion("0.3.0"),
        currentCompiledMethod: compiledMethodWithEngineVersion(
          runningVersion,
          "Outro método",
        ),
      }),
    ).toThrowError(/motor/i);
  });
});
