import {
  createMethodExecutionEngine,
  parseCompiledMethod,
  reconcileCompiledMethodEngine,
  runOfficialExecution,
  type CalibrationPhaseSnapshot,
} from "@calibra-facil/method-definition";
import { LocalUnprocessableError } from "@calibra-facil/local-db";
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
  const frozenCompiledMethod = input.methodSnapshot.compiledMethod;

  if (!isCompiledSnapshot(frozenCompiledMethod)) {
    return input.fallbackResults ?? null;
  }
  // A snapshot that declares itself compiled is proved with the schema the
  // cloud proves it with; a malformed one is refused like the cloud refuses it
  // (`snapshot_invalid`), never executed and never read as "no compiled method".
  const snapshotCompiledMethod = parseCompiledMethod(frozenCompiledMethod);
  if (!snapshotCompiledMethod) {
    throw new LocalUnprocessableError(
      "Snapshot compilado do método possui formato inválido",
      [
        {
          code: "COMPILED_METHOD_SNAPSHOT_INVALID",
          severity: "error",
          message: "Snapshot compilado do método possui formato inválido",
          path: "methodSnapshot.compiledMethod",
        },
      ],
    );
  }

  const engine = createMethodExecutionEngine();
  const { compiledMethod } = reconcileCompiledMethodEngine({
    snapshot: snapshotCompiledMethod,
    current: parseCompiledMethod(input.currentCompiledMethod),
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
    throw new LocalUnprocessableError(message, execution.diagnostics);
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

/** The snapshot says it holds a compiled method (what it holds is parsed after). */
function isCompiledSnapshot(value: unknown): boolean {
  return toRecord(value).status === "compiled";
}
