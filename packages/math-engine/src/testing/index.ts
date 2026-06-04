import type { MeasurementModelResult } from "../gum/measurement.js";
import type { FormulaEvaluationResult } from "../formula/compiled.js";

export function assertStableFormulaEvaluation(a: FormulaEvaluationResult, b: FormulaEvaluationResult): boolean {
  return a.calculationFingerprint === b.calculationFingerprint && a.valueText === b.valueText;
}

export function assertStableMeasurementResult(a: MeasurementModelResult, b: MeasurementModelResult): boolean {
  return a.calculationFingerprint === b.calculationFingerprint && a.canonicalResultJson === b.canonicalResultJson;
}
