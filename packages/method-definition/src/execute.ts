import { canonicalJson, fingerprintJson } from "./fingerprint";
import { runMethodPreview } from "./preview";
import type {
  CompiledMethod,
  CompiledMethodExecutionInput,
  CompiledMethodExecutionResult,
  ExecuteCompiledMethodOptions,
  NumericInput,
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
    },
    { engine: options.engine },
  );
  const outputs: Record<string, NumericInput> = {};

  for (const result of preview.formulaResults) {
    outputs[result.key] = result.value;
  }

  for (const result of preview.measurementModelResults) {
    outputs[result.key] = result.result.value;
  }

  const inputFingerprint = fingerprintJson(input.inputs, "execution-input");
  const calculationFingerprint = fingerprintJson(
    {
      methodFingerprint: method.methodFingerprint,
      inputFingerprint,
      inputs: input.inputs,
      outputs,
    },
    "calculation",
  );
  const canonicalResultJson = canonicalJson({
    methodFingerprint: method.methodFingerprint,
    engine: method.engine,
    inputFingerprint,
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
