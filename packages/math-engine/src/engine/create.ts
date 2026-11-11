import type { CompileFormulaOptions, CompiledFormula, FormulaEvaluationOptions } from "../formula/compiled.js";
import { compileFormulaInternal, isCompiledFormula, splitFormulaOptions } from "../formula/compiled.js";
import type { FormulaEvaluationResult } from "../formula/compiled.js";
import type { NumericInput } from "../numeric/types.js";
import type { MeasurementModelInput, MeasurementModelResult } from "../gum/measurement.js";
import { evaluateMeasurementModelInternal } from "../gum/measurement.js";
import { ERROR_CODES } from "../errors/codes.js";
import { makeError } from "../errors/errors.js";
import { valueKind } from "../validation/shape.js";
import type { CalculationEngineOptions, NormalizedCalculationEngineOptions } from "./options.js";
import { normalizeEngineOptions } from "./options.js";

export interface CalculationEngine {
  readonly options: NormalizedCalculationEngineOptions;
  compileFormula(expression: string, options?: CompileFormulaOptions): CompiledFormula;
  evaluateFormula(expression: string | CompiledFormula, inputs: Readonly<Record<string, NumericInput>>, options?: CompileFormulaOptions | FormulaEvaluationOptions): FormulaEvaluationResult;
  evaluateMeasurementModel(input: MeasurementModelInput): MeasurementModelResult;
}

class DefaultCalculationEngine implements CalculationEngine {
  readonly options: NormalizedCalculationEngineOptions;

  constructor(options: CalculationEngineOptions = {}) {
    this.options = normalizeEngineOptions(options);
    Object.freeze(this);
  }

  compileFormula(expression: string, options: CompileFormulaOptions = {}): CompiledFormula {
    return compileFormulaInternal(expression, this.options, options);
  }

  evaluateFormula(
    expression: string | CompiledFormula,
    inputs: Readonly<Record<string, NumericInput>>,
    options: CompileFormulaOptions | FormulaEvaluationOptions = {}
  ): FormulaEvaluationResult {
    // Both kinds of option hold for both kinds of formula. Up to 0.5.0 a string
    // took only the compile options (rejectUnusedInputs was refused) and a
    // compiled formula only the evaluation ones (review).
    const { compile, evaluation } = splitFormulaOptions(options);
    if (typeof expression === "string") return compileFormulaInternal(expression, this.options, compile).evaluate(inputs, evaluation);
    if (!isCompiledFormula(expression)) {
      throw makeError(ERROR_CODES.INVALID_INPUT_SHAPE, "Formula must be a string or a CompiledFormula returned by this package.", {
        path: "formula",
        valueType: valueKind(expression)
      });
    }
    expression.assertCompatibleWithOptions(this.options);
    if (compile.allowedVariables !== undefined) {
      const allowed = new Set(compile.allowedVariables);
      for (const variable of expression.variables) {
        if (!allowed.has(variable)) {
          throw makeError(ERROR_CODES.UNKNOWN_IDENTIFIER, "Formula references an unknown identifier.", { identifier: variable });
        }
      }
    }
    return expression.evaluate(inputs, evaluation);
  }

  evaluateMeasurementModel(input: MeasurementModelInput): MeasurementModelResult {
    return evaluateMeasurementModelInternal(input, this.options);
  }
}

Object.freeze(DefaultCalculationEngine.prototype);
Object.freeze(DefaultCalculationEngine);

export function createCalculationEngine(options: CalculationEngineOptions = {}): CalculationEngine {
  return new DefaultCalculationEngine(options);
}
