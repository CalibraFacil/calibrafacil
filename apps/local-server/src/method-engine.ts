import {
  createCalculationEngine,
  type CalculationEngineOptions,
  type MeasurementModelInput,
} from "@calibra-facil/math-engine";
import type {
  CalculationEngineLike,
  MeasurementModelInputLike,
} from "@calibra-facil/method-definition";

export const localMethodEngineOptions = {
  numericMode: "decimal",
  rejectUnusedInputs: true,
  maxExponentMagnitude: 12,
  maxSignificantDigits: 24,
} satisfies CalculationEngineOptions;

export function createMethodDefinitionEngine(
  options: CalculationEngineOptions = localMethodEngineOptions,
): CalculationEngineLike {
  const engine = createCalculationEngine(options);

  return {
    options: engine.options,
    compileFormula: (expression, compileOptions) =>
      engine.compileFormula(expression, compileOptions),
    evaluateFormula: (expression, inputs, evaluationOptions) => {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- method-definition accepts compiled expressions while math-engine overloads require its concrete formula input.
      const engineExpression = expression as Parameters<typeof engine.evaluateFormula>[0];
      return engine.evaluateFormula(engineExpression, inputs, evaluationOptions);
    },
    evaluateMeasurementModel: (input: MeasurementModelInputLike) => {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- method-definition uses a structurally compatible DTO that math-engine brands as MeasurementModelInput.
      return engine.evaluateMeasurementModel(input as MeasurementModelInput);
    },
  };
}
