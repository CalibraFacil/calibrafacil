import { canonicalJson, fingerprintJson } from "./fingerprint";
import { runMethodPreview } from "./preview";
import type {
  CompiledMethod,
  CompiledMethodExecutionInput,
  CompiledMethodExecutionResult,
  ExecuteCompiledMethodOptions,
} from "./types";

export function executeCompiledMethod(
  method: CompiledMethod,
  input: CompiledMethodExecutionInput,
  options: ExecuteCompiledMethodOptions,
): CompiledMethodExecutionResult {
  const preview = runMethodPreview(
    method,
    {
      key: "official_execution",
      label: "Official execution",
      inputs: input.inputs,
      calibrationPhases: input.calibrationPhases,
    },
    { engine: options.engine, calibrationPhases: input.calibrationPhases },
  );
  const outputs: CompiledMethodExecutionResult["outputs"] = {};

  for (const result of preview.formulaResults) {
    outputs[result.key] = result.value;
  }

  for (const result of preview.measurementModelResults) {
    const modelResult = result.result;
    outputs[result.key] = Array.isArray(modelResult)
      ? modelResult.map((item) => item.value)
      : (modelResult as { value: string | number }).value;
  }

  const executionInput = {
    inputs: input.inputs,
    calibrationPhases: input.calibrationPhases ?? null,
  };
  const inputFingerprint = fingerprintJson(executionInput, "execution-input");
  const calculationFingerprint = fingerprintJson(
    {
      methodFingerprint: method.methodFingerprint,
      inputFingerprint,
      ...executionInput,
      outputs,
    },
    "calculation",
  );
  const canonicalResultJson = canonicalJson({
    methodFingerprint: method.methodFingerprint,
    engine: method.engine,
    inputFingerprint,
    calibrationPhases: input.calibrationPhases ?? null,
    calculationFingerprint,
    formulaResults: preview.formulaResults,
    measurementModelResults: preview.measurementModelResults,
    acceptanceCriteriaResults: preview.acceptanceCriteriaResults,
    diagnostics: preview.diagnostics,
    outputs,
  });

  return {
    ok: preview.passed,
    methodFingerprint: method.methodFingerprint,
    engineVersion: method.engine.version,
    engineOptionsFingerprint: method.engine.optionsFingerprint,
    inputFingerprint,
    formulaResults: preview.formulaResults,
    measurementModelResults: preview.measurementModelResults,
    acceptanceCriteriaResults: preview.acceptanceCriteriaResults,
    diagnostics: preview.diagnostics,
    outputs,
    canonicalResultJson,
    calculationFingerprint,
    resultFingerprint: fingerprintJson(canonicalResultJson, "result"),
  };
}
