import {
  createCalculationEngine,
  METHOD_ENGINE_OPTIONS,
  type CalculationEngineOptions,
  type MeasurementModelInput,
} from "@calibra-facil/math-engine";
import type {
  CalculationEngineLike,
  MeasurementModelInputLike,
} from "@calibra-facil/method-definition";

// The shared numeric contract — must match the cloud API's engine so a method
// executed offline produces the same certificate values as the cloud path.
export const localMethodEngineOptions = METHOD_ENGINE_OPTIONS;

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
