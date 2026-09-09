import { DEFAULT_ENGINE_METADATA } from "./compile";
import { errorDiagnostic } from "./diagnostics";
import { canonicalJson, fingerprintJson } from "./fingerprint";
import { runMethodPreview } from "./preview";
import type {
  CalculationEngineLike,
  CompiledMethod,
  CompiledMethodExecutionInput,
  CompiledMethodExecutionResult,
  ExecuteCompiledMethodOptions,
} from "./types";

/** The version the engine instance reports about itself, when it does. */
function runningEngineVersion(engine: CalculationEngineLike): string | undefined {
  const engineOptions: unknown = engine.options;
  if (engineOptions === null || typeof engineOptions !== "object") return undefined;
  const version = Reflect.get(engineOptions, "engineVersion");
  return typeof version === "string" && version.length > 0 ? version : undefined;
}

/** The options fingerprint of the running engine, computed exactly as `compileMethodDraft` computes it. */
function runningEngineOptionsFingerprint(engine: CalculationEngineLike): string | undefined {
  const engineOptions: unknown = engine.options;
  if (engineOptions === null || typeof engineOptions !== "object") return undefined;
  return fingerprintJson(engineOptions, "engine-options");
}

/**
 * A compiled method is validated against one engine version AND one normalized
 * engine configuration, and its snapshot stamps both on every execution.
 * Executing it with a different engine would record results under a contract
 * that did not produce them, so the method must be recompiled (and
 * re-approved) first. Methods compiled without engine metadata (`"unknown"`)
 * and engines that do not report their version/options are not checked.
 */
function engineContractMismatch(
  method: CompiledMethod,
  engine: CalculationEngineLike,
):
  | { readonly field: "version"; readonly compiled: string; readonly running: string }
  | { readonly field: "options"; readonly compiled: string; readonly running: string }
  | undefined {
  if (method.engine.version === DEFAULT_ENGINE_METADATA.version) return undefined;
  const running = runningEngineVersion(engine);
  if (running !== undefined && running !== method.engine.version) {
    return { field: "version", compiled: method.engine.version, running };
  }
  // Same version, different numeric contract (a changed METHOD_ENGINE_OPTIONS,
  // or a number-mode engine): the results would differ while still being
  // stamped with the compiled options fingerprint (review).
  if (method.engine.optionsFingerprint === DEFAULT_ENGINE_METADATA.optionsFingerprint) {
    return undefined;
  }
  const runningOptions = runningEngineOptionsFingerprint(engine);
  if (runningOptions !== undefined && runningOptions !== method.engine.optionsFingerprint) {
    return { field: "options", compiled: method.engine.optionsFingerprint, running: runningOptions };
  }
  return undefined;
}

/**
 * Adopt a method's current compilation into a frozen execution snapshot when
 * the running engine no longer matches the snapshot's.
 *
 * A job freezes its own copy of the compiled method at creation, so recompiling
 * and re-approving the published method does not reach jobs already open. After
 * an engine release those snapshots would be permanently unexecutable (review).
 * The adoption is only safe — and only performed — when the current compilation
 * is of the very same method definition: the canonical normalized method text
 * with the engine block removed must be byte-identical, which proves nothing
 * but the engine contract changed. Anything else (missing, differing or
 * still-mismatched compilation) is left to the execution guard.
 */
/**
 * Canonical text of a compiled method with the engine block dropped — the
 * method definition alone. `normalizedMethodJson` carries the engine metadata,
 * so it necessarily differs across engine versions and cannot answer "is this
 * the same method?" on its own. Returns `null` when the text is not the
 * canonical JSON object this package produces.
 */
function methodIdentityWithoutEngine(method: CompiledMethod): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(method.normalizedMethodJson);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const entries = Object.entries(parsed).filter(([key]) => key !== "engine");
  return canonicalJson(Object.fromEntries(entries));
}

export function reconcileCompiledMethodEngine(params: {
  readonly snapshot: CompiledMethod;
  readonly current: CompiledMethod | null | undefined;
  readonly engine: CalculationEngineLike;
}): { readonly compiledMethod: CompiledMethod; readonly adopted: boolean } {
  const { snapshot, current, engine } = params;
  if (engineContractMismatch(snapshot, engine) === undefined) {
    return { compiledMethod: snapshot, adopted: false };
  }
  if (!current || engineContractMismatch(current, engine) !== undefined) {
    return { compiledMethod: snapshot, adopted: false };
  }
  const snapshotIdentity = methodIdentityWithoutEngine(snapshot);
  const currentIdentity = methodIdentityWithoutEngine(current);
  if (snapshotIdentity === null || snapshotIdentity !== currentIdentity) {
    return { compiledMethod: snapshot, adopted: false };
  }
  return { compiledMethod: current, adopted: true };
}

export function executeCompiledMethod(
  method: CompiledMethod,
  input: CompiledMethodExecutionInput,
  options: ExecuteCompiledMethodOptions,
): CompiledMethodExecutionResult {
  const mismatch = engineContractMismatch(method, options.engine);
  if (mismatch !== undefined) {
    const executionInput = {
      inputs: input.inputs,
      calibrationPhases: input.calibrationPhases ?? null,
    };
    const inputFingerprint = fingerprintJson(executionInput, "execution-input");
    const diagnostics = [
      mismatch.field === "version"
        ? errorDiagnostic(
            "ENGINE_VERSION_MISMATCH",
            `Método compilado com o motor ${mismatch.compiled}, mas o motor em execução é ${mismatch.running}; recompile o método antes de executar.`,
            "engine.version",
            {
              compiledEngineVersion: mismatch.compiled,
              runningEngineVersion: mismatch.running,
            },
          )
        : errorDiagnostic(
            "ENGINE_OPTIONS_MISMATCH",
            `Método compilado com outra configuração numérica do motor (${mismatch.compiled}); o motor em execução usa ${mismatch.running}; recompile o método antes de executar.`,
            "engine.optionsFingerprint",
            {
              compiledEngineOptionsFingerprint: mismatch.compiled,
              runningEngineOptionsFingerprint: mismatch.running,
            },
          ),
    ];
    const canonicalResultJson = canonicalJson({
      methodFingerprint: method.methodFingerprint,
      engine: method.engine,
      inputFingerprint,
      diagnostics,
    });
    return {
      ok: false,
      methodFingerprint: method.methodFingerprint,
      engineVersion: method.engine.version,
      engineOptionsFingerprint: method.engine.optionsFingerprint,
      inputFingerprint,
      formulaResults: [],
      measurementModelResults: [],
      acceptanceCriteriaResults: [],
      diagnostics,
      outputs: {},
      canonicalResultJson,
      calculationFingerprint: fingerprintJson(canonicalResultJson, "calculation"),
      resultFingerprint: fingerprintJson(canonicalResultJson, "result"),
    };
  }

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
    const value =
      modelResult && typeof modelResult === "object" && !Array.isArray(modelResult)
        ? Object.fromEntries(Object.entries(modelResult)).value
        : null;
    outputs[result.key] = Array.isArray(modelResult)
      ? modelResult.map((item) => item.value)
      : typeof value === "string" || typeof value === "number"
        ? value
        : 0;
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
