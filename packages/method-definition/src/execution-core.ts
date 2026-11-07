import {
  createCalculationEngine,
  METHOD_ENGINE_OPTIONS,
  type CalculationEngineOptions,
} from "@calibra-facil/math-engine";
import {
  isCalibrationPhaseMode,
  normalizeStandardsForOfficialExecution,
  type CalibrationLocationInput,
  type CalibrationLocationSnapshot,
  type CalibrationPhaseInput,
  type CalibrationPhaseSnapshot as FrozenCalibrationPhaseSnapshot,
  type NormalizableStandardSnapshot,
} from "@calibra-facil/shared";
import { isRecord, toRecord } from "@calibra-facil/shared/record";
import { executeCompiledMethod } from "./execute";
import type {
  CalculationEngineLike,
  CalibrationPhaseSnapshot,
  CompiledMethod,
  CompiledMethodExecutionResult,
} from "./types";

/**
 * The execution core both the cloud (`apps/api`, `packages/jobs-core`) and the
 * desktop (`apps/local-server`) call: how a calibration's frozen records are
 * built from what a caller sends, how the official execution of a frozen
 * compiled method is assembled and run, and the envelope its result is stored
 * in. One copy, so an execution on the desktop produces the same record the
 * cloud would.
 */

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/**
 * The engine every runtime builds to execute (or compile) methods: the numeric
 * contract that defines certificate values (`METHOD_ENGINE_OPTIONS`) unless a
 * caller passes its own.
 */
export function createMethodExecutionEngine(
  options: CalculationEngineOptions = METHOD_ENGINE_OPTIONS,
): CalculationEngineLike {
  return createCalculationEngine(options);
}

// ---------------------------------------------------------------------------
// The frozen location and phases of a calibration
// ---------------------------------------------------------------------------

export function buildCalibrationLocationSnapshot(
  input: CalibrationLocationInput | undefined,
  existing: CalibrationLocationSnapshot | null | undefined,
  actorUserId: string,
): CalibrationLocationSnapshot | undefined {
  if (!input) return existing ?? undefined;

  return {
    type: input.type,
    addressText: input.addressText.trim(),
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    recordedAt: new Date().toISOString(),
    recordedBy: actorUserId,
  };
}

export function buildCalibrationPhaseSnapshot(
  input: CalibrationPhaseInput | undefined,
  existing: FrozenCalibrationPhaseSnapshot | null | undefined,
  actorUserId: string,
): FrozenCalibrationPhaseSnapshot | undefined {
  if (!input) return existing ?? undefined;

  const blocks: FrozenCalibrationPhaseSnapshot["blocks"] = {};
  for (const [key, block] of Object.entries(input.blocks ?? {})) {
    if (!key.trim()) continue;
    if (!isCalibrationPhaseMode(block.mode)) continue;
    blocks[key] = {
      mode: block.mode,
      ...(block.reason?.trim() ? { reason: block.reason.trim() } : {}),
    };
  }

  return {
    blocks,
    recordedAt: new Date().toISOString(),
    recordedBy: actorUserId,
  };
}

/** A stored location snapshot (jsonb / SQLite text), told apart from anything else. */
export function isCalibrationLocationSnapshot(
  value: unknown,
): value is CalibrationLocationSnapshot {
  return (
    isRecord(value) &&
    (value.type === "customer_site" ||
      value.type === "lab" ||
      value.type === "other") &&
    typeof value.addressText === "string" &&
    typeof value.recordedAt === "string" &&
    typeof value.recordedBy === "string"
  );
}

/** A stored phase snapshot (jsonb / SQLite text), told apart from anything else. */
export function isCalibrationPhaseSnapshot(
  value: unknown,
): value is FrozenCalibrationPhaseSnapshot {
  return (
    isRecord(value) &&
    typeof value.recordedAt === "string" &&
    typeof value.recordedBy === "string" &&
    isRecord(value.blocks) &&
    Object.values(value.blocks).every(
      (block) => isRecord(block) && isCalibrationPhaseMode(block.mode),
    )
  );
}

// ---------------------------------------------------------------------------
// The official execution of a frozen compiled method
// ---------------------------------------------------------------------------

/** The key of `results` that holds the engine's provenance of the calculation. */
export const COMPILED_EXECUTION_KEY = "__compiledExecution";

/** What an official execution stores next to the method's outputs. */
export type CompiledExecutionEnvelope = Pick<
  CompiledMethodExecutionResult,
  | "methodFingerprint"
  | "engineVersion"
  | "engineOptionsFingerprint"
  | "inputFingerprint"
  | "calculationFingerprint"
  | "resultFingerprint"
  | "canonicalResultJson"
  | "formulaResults"
  | "measurementModelResults"
  | "acceptanceCriteriaResults"
  | "diagnostics"
>;

/** The `results` stored for an execution: the method's outputs plus the envelope. */
export function buildOfficialExecutionResults(
  execution: CompiledMethodExecutionResult,
): Record<string, unknown> {
  const envelope: CompiledExecutionEnvelope = {
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
  };
  return { ...execution.outputs, [COMPILED_EXECUTION_KEY]: envelope };
}

/**
 * What the official execution reads besides the worksheet `data`. The method
 * and asset snapshots are stored JSON, so those parts are read defensively.
 */
export type OfficialExecutionSources = {
  /** What the technician entered. */
  data: Record<string, unknown>;
  /** `methodSnapshot.dataFields`: the fields bound to an asset specification. */
  dataFields?: unknown;
  /** `assetSnapshot.specifications`. */
  assetSpecifications?: unknown;
  /** The frozen environment; when present it feeds `environment`. */
  environmental?: unknown;
  /**
   * The frozen reference standards, normalised to grams like every
   * authoritative path. `undefined` leaves `standards` out; `null` is none.
   */
  standards?: readonly NormalizableStandardSnapshot[] | null;
};

export function buildOfficialExecutionInputs(
  sources: OfficialExecutionSources,
): Record<string, unknown> {
  const inputs: Record<string, unknown> = { ...sources.data };
  const dataFields = Array.isArray(sources.dataFields)
    ? sources.dataFields
    : [];
  const specifications = toRecord(sources.assetSpecifications);

  for (const field of dataFields) {
    if (!isRecord(field)) continue;
    if (
      field.source === "asset_spec" &&
      typeof field.key === "string" &&
      typeof field.assetSpecKey === "string" &&
      field.assetSpecKey &&
      specifications[field.assetSpecKey] !== undefined
    ) {
      inputs[field.key] = specifications[field.assetSpecKey];
    }
  }

  if (sources.environmental) {
    const environment = toRecord(sources.environmental);
    inputs.environment = {
      temperature: environment.temperature,
      humidity: environment.humidity,
      pressure: environment.pressure,
    };
  }

  if (sources.standards !== undefined) {
    inputs.standards =
      normalizeStandardsForOfficialExecution(sources.standards) ?? [];
  }

  return inputs;
}

/**
 * Run a job's frozen compiled method over its data and wrap the outcome in
 * the stored `results` shape. The caller decides what a failed execution
 * means (a draft keeps the outputs it got; a submit refuses).
 */
export function runOfficialExecution(
  compiledMethod: CompiledMethod,
  sources: OfficialExecutionSources & {
    calibrationPhases?: CalibrationPhaseSnapshot | null;
    engine?: CalculationEngineLike;
  },
): {
  execution: CompiledMethodExecutionResult;
  results: Record<string, unknown>;
} {
  const execution = executeCompiledMethod(
    compiledMethod,
    {
      inputs: buildOfficialExecutionInputs(sources),
      calibrationPhases: sources.calibrationPhases ?? undefined,
    },
    { engine: sources.engine ?? createMethodExecutionEngine() },
  );
  return { execution, results: buildOfficialExecutionResults(execution) };
}
