import type {
  AssetSnapshot,
  CalibrationPhaseSnapshot,
  EnvironmentalSnapshot,
  MethodSnapshot,
  StandardSnapshot,
} from "@calibra-facil/db/schema";
import {
  executeCompiledMethod,
  type CalculationEngineLike,
  type CompiledMethod,
  type CompiledMethodExecutionResult,
  type MethodDiagnostic,
} from "@calibra-facil/method-definition";
import {
  createCalculationEngine,
  METHOD_ENGINE_OPTIONS,
} from "@calibra-facil/math-engine";
import { normalizeStandardsForOfficialExecution } from "@calibra-facil/shared";
import { isCompiledMethod } from "./helpers";

/**
 * The official execution of a job's frozen compiled method: the ONE place the
 * server recomputes `results` from `data`. The submit/execute command runs it
 * for every caller (cloud routes, public API, desktop sync); no caller's own
 * `results` is ever stored.
 */

export function createMethodExecutionEngine(): CalculationEngineLike {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- math-engine exposes a narrower concrete type than the method-definition execution adapter.
  return createCalculationEngine(
    METHOD_ENGINE_OPTIONS,
  ) as unknown as CalculationEngineLike;
}

function executionDiagnostic(
  code: string,
  message: string,
  path: string,
): MethodDiagnostic {
  return { code, severity: "error", message, path };
}

/**
 * Why the frozen compiled method could not be used. `snapshot_required` and
 * `snapshot_invalid` mean the job carries no usable compiled method;
 * `snapshot_mismatch` means its fingerprints disagree with the job's own
 * metadata. Transports map these to their own wording and codes.
 */
export type CompiledSnapshotFailureKind =
  | "snapshot_required"
  | "snapshot_invalid"
  | "snapshot_mismatch";

type CompiledSnapshotResult =
  | { ok: true; compiledMethod: CompiledMethod }
  | {
      ok: false;
      kind: CompiledSnapshotFailureKind;
      message: string;
      diagnostics: MethodDiagnostic[];
    };

function getCompiledMethodSnapshot(
  methodSnapshot: MethodSnapshot | null | undefined,
): CompiledSnapshotResult {
  const compiledMethod = methodSnapshot?.compiledMethod;
  if (
    !methodSnapshot ||
    !compiledMethod ||
    typeof compiledMethod !== "object" ||
    !methodSnapshot.methodFingerprint ||
    !methodSnapshot.engineVersion ||
    !methodSnapshot.engineOptionsFingerprint ||
    !methodSnapshot.normalizedMethodJson
  ) {
    const message =
      "Snapshot compilado do método é obrigatório para execução regulada";
    return {
      ok: false,
      kind: "snapshot_required",
      message,
      diagnostics: [
        executionDiagnostic(
          "COMPILED_METHOD_SNAPSHOT_REQUIRED",
          message,
          "methodSnapshot.compiledMethod",
        ),
      ],
    };
  }

  if (!isCompiledMethod(compiledMethod)) {
    const message = "Snapshot compilado do método possui formato inválido";
    return {
      ok: false,
      kind: "snapshot_invalid",
      message,
      diagnostics: [
        executionDiagnostic(
          "COMPILED_METHOD_SNAPSHOT_INVALID",
          message,
          "methodSnapshot.compiledMethod",
        ),
      ],
    };
  }

  const candidate = compiledMethod;
  const mismatches: MethodDiagnostic[] = [];
  if (candidate.methodFingerprint !== methodSnapshot.methodFingerprint) {
    mismatches.push(
      executionDiagnostic(
        "COMPILED_METHOD_SNAPSHOT_MISMATCH",
        "Fingerprint do método compilado diverge do snapshot do job",
        "methodSnapshot.methodFingerprint",
      ),
    );
  }
  if (candidate.engine?.version !== methodSnapshot.engineVersion) {
    mismatches.push(
      executionDiagnostic(
        "COMPILED_METHOD_SNAPSHOT_MISMATCH",
        "Versão do engine compilado diverge do snapshot do job",
        "methodSnapshot.engineVersion",
      ),
    );
  }
  if (
    candidate.engine?.optionsFingerprint !==
    methodSnapshot.engineOptionsFingerprint
  ) {
    mismatches.push(
      executionDiagnostic(
        "COMPILED_METHOD_SNAPSHOT_MISMATCH",
        "Fingerprint das opções do engine diverge do snapshot do job",
        "methodSnapshot.engineOptionsFingerprint",
      ),
    );
  }
  if (candidate.normalizedMethodJson !== methodSnapshot.normalizedMethodJson) {
    mismatches.push(
      executionDiagnostic(
        "COMPILED_METHOD_SNAPSHOT_MISMATCH",
        "JSON normalizado do método compilado diverge do snapshot do job",
        "methodSnapshot.normalizedMethodJson",
      ),
    );
  }
  if (mismatches.length > 0) {
    return {
      ok: false,
      kind: "snapshot_mismatch",
      message: "Snapshot compilado do método diverge dos metadados do job",
      diagnostics: mismatches,
    };
  }

  return { ok: true, compiledMethod };
}

function buildOfficialExecutionInputs(params: {
  methodSnapshot: MethodSnapshot;
  data: Record<string, unknown>;
  assetSnapshot: AssetSnapshot;
  standardsSnapshot: StandardSnapshot[] | null | undefined;
  environmentalSnapshot: EnvironmentalSnapshot | null | undefined;
}): Record<string, unknown> {
  const inputs: Record<string, unknown> = { ...params.data };

  for (const field of params.methodSnapshot.dataFields ?? []) {
    if (field.source !== "asset_spec" || !field.assetSpecKey) continue;
    const value = params.assetSnapshot.specifications?.[field.assetSpecKey];
    if (value !== undefined) {
      inputs[field.key] = value;
    }
  }

  if (params.environmentalSnapshot) {
    inputs.environment = {
      temperature: params.environmentalSnapshot.temperature,
      humidity: params.environmentalSnapshot.humidity,
      pressure: params.environmentalSnapshot.pressure,
    };
  }

  if (params.standardsSnapshot !== undefined) {
    inputs.standards =
      normalizeStandardsForOfficialExecution(params.standardsSnapshot) ?? [];
  }

  return inputs;
}

type OfficialExecutionOutcome =
  | {
      ok: true;
      results: Record<string, unknown>;
      execution: CompiledMethodExecutionResult;
    }
  | {
      ok: false;
      kind: CompiledSnapshotFailureKind | "execution_failed";
      message: string;
      diagnostics: MethodDiagnostic[];
    };

/**
 * Run the job's frozen compiled method over its data. With `requireSuccess`
 * false (a draft save) a failed or partial execution still yields the outputs
 * and diagnostics it produced, so the worksheet keeps saving while it is
 * incomplete; a submit requires success. A job with no usable compiled method
 * is refused either way.
 */
export function executeOfficialCompiledSnapshot(params: {
  methodSnapshot: MethodSnapshot;
  data: Record<string, unknown>;
  assetSnapshot: AssetSnapshot;
  standardsSnapshot: StandardSnapshot[] | null | undefined;
  environmentalSnapshot: EnvironmentalSnapshot | null | undefined;
  calibrationPhaseSnapshot: CalibrationPhaseSnapshot | null | undefined;
  requireSuccess: boolean;
}): OfficialExecutionOutcome {
  const snapshot = getCompiledMethodSnapshot(params.methodSnapshot);
  if (!snapshot.ok) {
    return snapshot;
  }

  const execution = executeCompiledMethod(
    snapshot.compiledMethod,
    {
      inputs: buildOfficialExecutionInputs(params),
      calibrationPhases: params.calibrationPhaseSnapshot ?? undefined,
    },
    { engine: createMethodExecutionEngine() },
  );

  if (!execution.ok && params.requireSuccess) {
    return {
      ok: false,
      kind: "execution_failed",
      diagnostics: execution.diagnostics,
      message:
        execution.diagnostics.find((item) => item.severity === "error")
          ?.message ?? "Execução oficial do método compilado falhou",
    };
  }

  return {
    ok: true,
    results: {
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
    },
    execution,
  };
}
