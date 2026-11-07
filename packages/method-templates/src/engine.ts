import {
  METHOD_ENGINE_OPTIONS,
  normalizeEngineOptions,
} from "@calibra-facil/math-engine";
import {
  createMethodExecutionEngine,
  fingerprintJson,
  type CalculationEngineLike,
  type EngineMetadata,
} from "@calibra-facil/method-definition";

/**
 * Every method template is compiled with the engine that executes methods
 * (`METHOD_ENGINE_OPTIONS`): the resulting `optionsFingerprint` is folded into
 * every published method's fingerprint, so the compile and the runtime
 * execution can never use different numeric contracts. Seed scripts get the
 * engine and its metadata from here.
 */
export function createTemplateEngine(): CalculationEngineLike {
  return createMethodExecutionEngine(METHOD_ENGINE_OPTIONS);
}

/** Engine metadata (version + options fingerprint) for `compileMethodDraft`. */
export function templateEngineMetadata(): EngineMetadata {
  const normalized = normalizeEngineOptions(METHOD_ENGINE_OPTIONS);
  return {
    packageName: "@calibra-facil/math-engine",
    version: normalized.engineVersion,
    optionsFingerprint: fingerprintJson(normalized, "engine-options"),
  };
}
