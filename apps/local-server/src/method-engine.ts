import {
  createCalculationEngine,
  type CalculationEngineOptions,
  type MeasurementModelInput,
} from '@calibra-facil/math-engine'
import type {
  CalculationEngineLike,
  MeasurementModelInputLike,
} from '@calibra-facil/method-definition'

export const localMethodEngineOptions = {
  numericMode: 'decimal',
  rejectUnusedInputs: true,
  maxExponentMagnitude: 12,
  maxSignificantDigits: 24,
} satisfies CalculationEngineOptions

export function createMethodDefinitionEngine(
  options: CalculationEngineOptions = localMethodEngineOptions,
): CalculationEngineLike {
  const engine = createCalculationEngine(options)

  return {
    options: engine.options,
    compileFormula: (expression, compileOptions) =>
      engine.compileFormula(expression, compileOptions),
    evaluateFormula: (expression, inputs, evaluationOptions) =>
      engine.evaluateFormula(
        expression as Parameters<typeof engine.evaluateFormula>[0],
        inputs,
        evaluationOptions,
      ),
    evaluateMeasurementModel: (input: MeasurementModelInputLike) =>
      engine.evaluateMeasurementModel(input as MeasurementModelInput),
  }
}
