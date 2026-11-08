import {
  compileMethodDraft,
  createMethodExecutionEngine,
  methodEngineMetadata,
} from "@calibra-facil/method-definition";

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
  const engineMetadata = methodEngineMetadata();
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
      engine: createMethodExecutionEngine(),
      engineMetadata,
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
    engineVersion: engineMetadata.version,
    engineOptionsFingerprint: engineMetadata.optionsFingerprint,
    normalizedMethodJson: compiled.method.normalizedMethodJson,
  };
}
