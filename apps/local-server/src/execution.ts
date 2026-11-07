import {
  createMethodExecutionEngine,
  reconcileCompiledMethodEngine,
  runOfficialExecution,
  type CalibrationPhaseSnapshot,
  type CompiledMethod,
} from "@calibra-facil/method-definition";
import { toRecord } from "@calibra-facil/shared/record";

type ExecutionInput = {
  methodSnapshot: Record<string, unknown>;
  assetSnapshot: Record<string, unknown>;
  standardsSnapshot?: unknown;
  environmentalSnapshot?: unknown;
  data: Record<string, unknown>;
  fallbackResults?: Record<string, unknown> | null;
  requireSuccess?: boolean;
  calibrationPhaseSnapshot?: CalibrationPhaseSnapshot | null;
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

  const engine = createMethodExecutionEngine();
  const { compiledMethod } = reconcileCompiledMethodEngine({
    snapshot: snapshotCompiledMethod,
    current: isCompiledMethod(input.currentCompiledMethod)
      ? input.currentCompiledMethod
      : null,
    engine,
  });

  // The execution core the cloud runs: same inputs assembly (asset
  // specifications, environment, standards in grams), same result envelope.
  const { execution, results } = runOfficialExecution(compiledMethod, {
    data: input.data,
    dataFields: input.methodSnapshot.dataFields,
    assetSpecifications: input.assetSnapshot.specifications,
    environmental: input.environmentalSnapshot,
    standards: standardsOf(input.standardsSnapshot),
    calibrationPhases: input.calibrationPhaseSnapshot,
    engine,
  });

  if (!execution.ok && input.requireSuccess) {
    const message =
      execution.diagnostics.find((item) => item.severity === "error")
        ?.message ?? "Execucao local do metodo compilado falhou";
    const error = Object.assign(new Error(message), {
      diagnostics: execution.diagnostics,
    });
    throw error;
  }

  return results;
}

/**
 * The frozen standards as the core reads them: the saved list, or none when
 * the snapshot is absent; `undefined` (never frozen) stays undefined.
 */
function standardsOf(snapshot: unknown) {
  if (snapshot === undefined) return undefined;
  return Array.isArray(snapshot) ? snapshot : null;
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
