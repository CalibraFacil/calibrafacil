import {
  createCalculationEngine,
  normalizeEngineOptions,
  type CalculationEngineOptions,
} from "@calibra-facil/math-engine";
import {
  fingerprintJson,
  type CalculationEngineLike,
  type EngineMetadata,
} from "@calibra-facil/method-definition";

/**
 * Engine options used to compile every method template.
 *
 * These MUST stay byte-identical to the options in
 * `packages/db/scripts/seed-exemplo-balance-method.mjs` — the resulting
 * `optionsFingerprint` is folded into every published method's fingerprint, so
 * a drift here would change the fingerprint of already-published methods. The
 * seed script imports {@link TEMPLATE_ENGINE_OPTIONS} from here so there is a
 * single source of truth.
 */
export const TEMPLATE_ENGINE_OPTIONS: CalculationEngineOptions = {
  numericMode: "decimal",
  rejectUnusedInputs: true,
  maxExponentMagnitude: 12,
  maxSignificantDigits: 24,
};

export function createTemplateEngine(): CalculationEngineLike {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- math-engine has narrower input parameter types than method-definition's adapter interface, but the runtime method surface is compatible (same pattern as apps/api compileDraftWithEngine).
  return createCalculationEngine(
    TEMPLATE_ENGINE_OPTIONS,
  ) as unknown as CalculationEngineLike;
}

/** Engine metadata (version + options fingerprint) for `compileMethodDraft`. */
export function templateEngineMetadata(): EngineMetadata {
  const normalized = normalizeEngineOptions(TEMPLATE_ENGINE_OPTIONS);
  return {
    packageName: "@calibra-facil/math-engine",
    version: normalized.engineVersion,
    optionsFingerprint: fingerprintJson(normalized, "engine-options"),
  };
}
