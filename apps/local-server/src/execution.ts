import {
  executeCompiledMethod,
  type CompiledMethod,
} from "@calibra-facil/method-definition";
import { createMethodDefinitionEngine } from "./method-engine";

type ExecutionInput = {
  methodSnapshot: Record<string, unknown>;
  assetSnapshot: Record<string, unknown>;
  standardsSnapshot?: unknown;
  environmentalSnapshot?: unknown;
  data: Record<string, unknown>;
  fallbackResults?: Record<string, unknown> | null;
  requireSuccess?: boolean;
  calibrationPhaseSnapshot?: Record<string, unknown> | null;
};

export function executeLocalCompiledMethod(input: ExecutionInput) {
  const compiledMethod = input.methodSnapshot.compiledMethod;

  if (!isCompiledMethod(compiledMethod)) {
    return input.fallbackResults ?? null;
  }

  const execution = executeCompiledMethod(
    compiledMethod,
    {
      inputs: buildExecutionInputs(input),
      calibrationPhases:
        input.calibrationPhaseSnapshot &&
        isCalibrationPhaseSnapshot(input.calibrationPhaseSnapshot)
          ? input.calibrationPhaseSnapshot
          : undefined,
    },
    {
      engine: createMethodDefinitionEngine(),
    },
  );

  if (!execution.ok && input.requireSuccess) {
    const message =
      execution.diagnostics.find((item) => item.severity === "error")
        ?.message ?? "Execucao local do metodo compilado falhou";
    const error = new Error(message) as Error & { diagnostics?: unknown };
    error.diagnostics = execution.diagnostics;
    throw error;
  }

  return {
    ...execution.outputs,
    __compiledExecution: {
      methodFingerprint: execution.methodFingerprint,
      engineVersion: execution.engineVersion,
      engineOptionsFingerprint: execution.engineOptionsFingerprint,
      inputFingerprint: execution.inputFingerprint,
      calculationFingerprint: execution.calculationFingerprint,
      resultFingerprint: execution.resultFingerprint,
      canonicalResultJson: execution.canonicalResultJson,
      formulaResults: execution.formulaResults,
      measurementModelResults: execution.measurementModelResults,
      acceptanceCriteriaResults: execution.acceptanceCriteriaResults,
      diagnostics: execution.diagnostics,
    },
  };
}

function isCalibrationPhaseSnapshot(value: Record<string, unknown>): value is {
  blocks: Record<
    string,
    {
      mode: "before_and_after" | "before_only" | "after_only" | "not_performed";
      reason?: string | null;
    }
  >;
} {
  return (
    value.blocks !== null &&
    typeof value.blocks === "object" &&
    !Array.isArray(value.blocks)
  );
}

function buildExecutionInputs(input: ExecutionInput) {
  const values: Record<string, unknown> = { ...input.data };
  const dataFields = Array.isArray(input.methodSnapshot.dataFields)
    ? input.methodSnapshot.dataFields
    : [];
  const specifications =
    input.assetSnapshot.specifications &&
    typeof input.assetSnapshot.specifications === "object"
      ? (input.assetSnapshot.specifications as Record<string, unknown>)
      : {};

  for (const field of dataFields) {
    if (!field || typeof field !== "object") continue;
    const record = field as Record<string, unknown>;
    if (
      record.source === "asset_spec" &&
      typeof record.key === "string" &&
      typeof record.assetSpecKey === "string" &&
      specifications[record.assetSpecKey] !== undefined
    ) {
      values[record.key] = specifications[record.assetSpecKey];
    }
  }

  if (input.environmentalSnapshot) {
    const environment = input.environmentalSnapshot as Record<string, unknown>;
    values.environment = {
      temperature: environment.temperature,
      humidity: environment.humidity,
      pressure: environment.pressure,
    };
  }

  if (input.standardsSnapshot !== undefined) {
    values.standards = input.standardsSnapshot ?? [];
  }

  return values;
}

function isCompiledMethod(value: unknown): value is CompiledMethod {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { status?: unknown }).status === "compiled"
  );
}
