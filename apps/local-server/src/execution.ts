import {
  executeCompiledMethod,
  reconcileCompiledMethodEngine,
  type CompiledMethod,
} from "@calibra-facil/method-definition";
import { normalizeStandardsForOfficialExecution } from "@calibra-facil/shared";
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
  /**
   * The compiled method currently published for this method locally, when the
   * caller has it. A job freezes its own copy at creation, so after a desktop
   * release ships a new engine the frozen copy no longer matches and would be
   * refused forever; the reconciliation below adopts this one when it is
   * provably the same method definition (review of the 0.4.0 execution guard).
   */
  currentCompiledMethod?: unknown;
};

export function executeLocalCompiledMethod(input: ExecutionInput) {
  const snapshotCompiledMethod = input.methodSnapshot.compiledMethod;

  if (!isCompiledMethod(snapshotCompiledMethod)) {
    return input.fallbackResults ?? null;
  }

  const engine = createMethodDefinitionEngine();
  const { compiledMethod } = reconcileCompiledMethodEngine({
    snapshot: snapshotCompiledMethod,
    current: isCompiledMethod(input.currentCompiledMethod)
      ? input.currentCompiledMethod
      : null,
    engine,
  });

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
    { engine },
  );

  if (!execution.ok && input.requireSuccess) {
    const message =
      execution.diagnostics.find((item) => item.severity === "error")
        ?.message ?? "Execucao local do metodo compilado falhou";
    const error = Object.assign(new Error(message), {
      diagnostics: execution.diagnostics,
    });
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
      ? toRecord(input.assetSnapshot.specifications)
      : {};

  for (const field of dataFields) {
    if (!field || typeof field !== "object") continue;
    const record = toRecord(field);
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
    const environment = toRecord(input.environmentalSnapshot);
    values.environment = {
      temperature: environment.temperature,
      humidity: environment.humidity,
      pressure: environment.pressure,
    };
  }

  if (input.standardsSnapshot !== undefined) {
    // Normalize certified masses/uncertainties to grams exactly as the cloud does
    // before official execution, so offline (desktop) results match what sync
    // recomputes for non-gram labs (audit H4).
    const snapshot = input.standardsSnapshot;
    values.standards = Array.isArray(snapshot)
      ? (normalizeStandardsForOfficialExecution(snapshot) ?? [])
      : (snapshot ?? []);
  }

  return values;
}

function isCompiledMethod(value: unknown): value is CompiledMethod {
  const record = toRecord(value);
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    record.status === "compiled"
  );
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}
