import {
  compileMethodDraft,
  fingerprintJson,
  type CalculationEngineLike,
} from "@calibra-facil/method-definition";
import {
  createCalculationEngine,
  METHOD_ENGINE_OPTIONS,
  normalizeEngineOptions,
} from "@calibra-facil/math-engine";

/** The minimal NOT NULL method snapshot a calibration_job row needs. */
export function minimalMethodSnapshot() {
  return {
    methodId: 1,
    methodName: "Test Method",
    methodVersion: 1,
    dataFields: [],
    variableBindings: [],
    formulas: [],
    measurementModels: [],
    validations: [],
    uncertaintyParams: [],
  } satisfies Record<string, unknown>;
}

/**
 * A real, executable compiled method (one scalar error formula) so that submit,
 * execute and the desktop sync apply get past the official-execution gate and
 * reach their status write. Compiled with the same engine the routes execute
 * with.
 */
export function executableMethodSnapshot() {
  const normalizedOptions = normalizeEngineOptions(METHOD_ENGINE_OPTIONS);
  // oxlint-disable-next-line typescript/consistent-type-assertions -- same adapter cast as routes/methods.ts and routes/jobs.ts: math-engine exposes a narrower concrete type than method-definition's engine interface.
  const engine = createCalculationEngine(
    METHOD_ENGINE_OPTIONS,
  ) as unknown as CalculationEngineLike;
  const engineVersion = normalizedOptions.engineVersion;
  const optionsFingerprint = fingerprintJson(
    normalizedOptions,
    "engine-options",
  );
  const compiled = compileMethodDraft(
    {
      id: "erro_indicacao",
      version: 1,
      status: "draft",
      name: "Erro de indicação",
      inputs: [
        {
          kind: "scalar",
          key: "indication",
          label: "Indicação",
          unit: "g",
          required: true,
        },
        {
          kind: "scalar",
          key: "reference",
          label: "Referência",
          unit: "g",
          required: true,
        },
      ],
      formulas: [
        {
          key: "error",
          label: "Erro",
          expression: "indication - reference",
          outputUnit: "g",
          outputKind: "error",
          required: true,
        },
      ],
    },
    {
      engine,
      engineMetadata: {
        packageName: "@calibra-facil/math-engine",
        version: engineVersion,
        optionsFingerprint,
      },
    },
  );
  if (!compiled.ok) {
    throw new Error(
      `executableMethodSnapshot: ${JSON.stringify(compiled.diagnostics)}`,
    );
  }
  return {
    ...minimalMethodSnapshot(),
    compiledMethod: compiled.method,
    methodFingerprint: compiled.method.methodFingerprint,
    engineVersion,
    engineOptionsFingerprint: optionsFingerprint,
    normalizedMethodJson: compiled.method.normalizedMethodJson,
  };
}
