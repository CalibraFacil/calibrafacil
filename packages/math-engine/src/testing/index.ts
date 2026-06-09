import type { MeasurementModelResult } from "../gum/measurement.js";
import type { FormulaEvaluationResult } from "../formula/compiled.js";

// These assertions THROW on mismatch (rather than returning a boolean that an
// `assert*` caller would silently ignore if not wrapped in expect()).
export function assertStableFormulaEvaluation(
  a: FormulaEvaluationResult,
  b: FormulaEvaluationResult,
): void {
  if (
    a.calculationFingerprint !== b.calculationFingerprint ||
    a.valueText !== b.valueText
  ) {
    throw new Error(
      `Formula evaluation is not stable: fingerprint ${a.calculationFingerprint} vs ${b.calculationFingerprint}, value ${a.valueText} vs ${b.valueText}.`,
    );
  }
}

export function assertStableMeasurementResult(
  a: MeasurementModelResult,
  b: MeasurementModelResult,
): void {
  if (
    a.calculationFingerprint !== b.calculationFingerprint ||
    a.canonicalResultJson !== b.canonicalResultJson
  ) {
    throw new Error(
      `Measurement result is not stable: fingerprint ${a.calculationFingerprint} vs ${b.calculationFingerprint}.`,
    );
  }
}
