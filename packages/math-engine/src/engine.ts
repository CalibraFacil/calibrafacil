import { createSecureMath, type MathEngineConfig } from "./config";
import { ENGINE_VERSION } from "./constants";
import {
  calculateTypeA,
  calculateTypeB,
  calculateCombinedUncertainty,
} from "./gum";
import {
  flattenForExecution,
  extractReadings,
  injectEnvironmentData,
  injectInstrumentSpecs,
  getInputsUsed,
  type FlattenOptions,
} from "./flatten";
import {
  TypeAInputSchema,
  TypeBComponentSchema,
  FormulaExecutionInputSchema,
  CalibrationDataSchema,
  type TypeAInput,
  type TypeAResult,
  type TypeBComponent,
  type TypeBResult,
  type CombinedUncertaintyResult,
  type FormulaExecutionInput,
  type FormulaExecutionResult,
  type CalibrationData,
  type CalibrationResult,
  type FormulaContext,
  type MathEngineError,
  type MathEngineErrorCode,
  type CalculationTrace,
} from "./types";

// ============================================
// Result wrapper
// ============================================
export type EngineResult<T> =
  | { success: true; data: T }
  | { success: false; error: MathEngineError };

// ============================================
// CalibrationEngine class
// ============================================
export class CalibrationEngine {
  private secureMath: ReturnType<typeof createSecureMath>;
  private config: MathEngineConfig;

  constructor(config: Partial<MathEngineConfig> = {}) {
    this.config = {
      precision: config.precision ?? 32,
      predictable: config.predictable ?? true,
      verbose: config.verbose ?? false,
    };
    this.secureMath = createSecureMath(this.config);
  }

  /**
   * Add a trace entry when verbose mode is enabled
   */
  private addTrace(
    trace: CalculationTrace[] | undefined,
    step: string,
    operation: string,
    inputs: Record<string, unknown>,
    output: unknown
  ): void {
    if (trace) {
      trace.push({
        step,
        operation,
        inputs,
        output,
        timestamp: Date.now(),
      });
    }
  }

  // ============================================
  // Formula Execution (sync only)
  // ============================================
  evaluateFormula(
    input: FormulaExecutionInput,
  ): EngineResult<FormulaExecutionResult> {
    try {
      const requestedPrecision = input.precision ?? this.config.precision;
      const validated = FormulaExecutionInputSchema.parse({
        ...input,
        precision: requestedPrecision,
      });
      const startTime = performance.now();

      // Use a call-local evaluator for non-default precision so precision
      // choices never leak into later formula executions on this engine.
      const secureMath =
        validated.precision === this.config.precision
          ? this.secureMath
          : createSecureMath({
              ...this.config,
              precision: validated.precision,
            });

      const result = secureMath.evaluate(
        validated.formula,
        validated.context as Record<string, unknown>,
      );
      const executionTimeMs = performance.now() - startTime;

      // Convert result - supports scalars AND arrays (vector math)
      // IMPORTANT: We store STRING representations to preserve BigNumber precision
      // and avoid "Cannot convert >15 significant digits" errors when chaining formulas
      let resultAsNumber: number | null = null;
      let resultValue: string | string[];

      // 1. Handle BigNumber (mathjs arbitrary precision)
      if (
        typeof result === "object" &&
        result !== null &&
        "toNumber" in result &&
        "toString" in result
      ) {
        resultAsNumber = (result as { toNumber: () => number }).toNumber();
        // Store as STRING to preserve precision for subsequent formulas
        resultValue = (result as { toString: () => string }).toString();
      }
      // 2. Handle Arrays / Matrices (Vector Math: e.g., `readings - standard`)
      else if (
        Array.isArray(result) ||
        (typeof result === "object" && result !== null && "toArray" in result)
      ) {
        // Convert mathjs Matrix to JS Array if needed
        const arr: unknown[] = Array.isArray(result)
          ? result
          : (result as { toArray: () => unknown[] }).toArray();

        // Convert BigNumbers inside array to STRING to preserve precision
        resultValue = arr.map((item: unknown) => {
          if (typeof item === "object" && item !== null && "toString" in item) {
            return (item as { toString: () => string }).toString();
          }
          if (typeof item === "number") return String(item);
          return String(item);
        });

        // Array result - no single number representation
        resultAsNumber = null;
      }
      // 3. Handle plain numbers - convert to string to avoid precision issues
      else if (typeof result === "number") {
        resultAsNumber = result;
        resultValue = String(result);
      }
      // 4. Handle booleans (from validation expressions)
      else if (typeof result === "boolean") {
        resultAsNumber = result ? 1 : 0;
        resultValue = String(resultAsNumber);
      }
      // 5. Fallback for strings or other types
      else {
        resultValue = String(result);
        const parsed = Number(result);
        resultAsNumber = isNaN(parsed) ? null : parsed;
      }

      return {
        success: true,
        data: {
          result: resultValue,
          resultAsNumber,
          formula: validated.formula,
          executionTimeMs,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: this.classifyError(error),
          message: error instanceof Error ? error.message : String(error),
          details: error,
        },
      };
    }
  }

  // ============================================
  // Type A Calculation
  // ============================================
  calculateTypeA(input: TypeAInput): EngineResult<TypeAResult> {
    try {
      const validated = TypeAInputSchema.parse(input);
      const result = calculateTypeA(validated);
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: {
          code: this.classifyError(error),
          message: error instanceof Error ? error.message : String(error),
          details: error,
        },
      };
    }
  }

  // ============================================
  // Type B Calculation
  // ============================================
  calculateTypeB(components: TypeBComponent[]): EngineResult<TypeBResult> {
    try {
      const validated = components.map((c) => TypeBComponentSchema.parse(c));
      const result = calculateTypeB(validated);
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: {
          code: this.classifyError(error),
          message: error instanceof Error ? error.message : String(error),
          details: error,
        },
      };
    }
  }

  // ============================================
  // Combined Uncertainty
  // ============================================
  calculateCombined(
    typeA?: TypeAResult,
    typeB?: TypeBResult,
    confidenceLevel: number = 0.9545,
  ): EngineResult<CombinedUncertaintyResult> {
    try {
      const result = calculateCombinedUncertainty(
        { typeA, typeB },
        confidenceLevel,
      );
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: {
          code: this.classifyError(error),
          message: error instanceof Error ? error.message : String(error),
          details: error,
        },
      };
    }
  }

  // ============================================
  // Full Calibration Calculation
  // ============================================
  performCalibration(
    data: CalibrationData,
    typeBComponents: TypeBComponent[] = [],
    formulas: string[] = [],
    confidenceLevel: number = 0.9545,
  ): EngineResult<CalibrationResult> {
    try {
      const validated = CalibrationDataSchema.parse(data);

      // Initialize trace array if verbose mode is enabled
      const trace: CalculationTrace[] | undefined = this.config.verbose
        ? []
        : undefined;

      // Extract readings for Type A
      const readings = extractReadings(validated as Record<string, unknown>);
      let typeAResult: TypeAResult | undefined;

      this.addTrace(trace, "extractReadings", "extractReadings(data)", {
        dataKeys: Object.keys(validated),
      }, { readingsCount: readings.length, readings });

      if (readings.length >= 2) {
        const typeACalc = this.calculateTypeA({ readings });
        if (typeACalc.success) {
          typeAResult = typeACalc.data;
          this.addTrace(trace, "TypeA", "u_A = s / sqrt(n)", {
            readings,
            n: readings.length,
          }, typeAResult);
        }
      }

      // Calculate Type B if components provided
      let typeBResult: TypeBResult | undefined;
      if (typeBComponents.length > 0) {
        const typeBCalc = this.calculateTypeB(typeBComponents);
        if (typeBCalc.success) {
          typeBResult = typeBCalc.data;
          this.addTrace(trace, "TypeB", "u_B = sqrt(sum(u_i^2))", {
            components: typeBComponents.map((c) => c.name),
          }, typeBResult);
        }
      }

      // Calculate combined uncertainty
      const combinedCalc = this.calculateCombined(typeAResult, typeBResult, confidenceLevel);
      if (!combinedCalc.success) {
        return combinedCalc;
      }

      this.addTrace(trace, "Combined", "u_c = sqrt(u_A^2 + u_B^2), U = k * u_c", {
        hasTypeA: !!typeAResult,
        hasTypeB: !!typeBResult,
      }, combinedCalc.data);

      // Prepare context for formula execution
      let context = flattenForExecution(validated as Record<string, unknown>);

      if (validated.environment) {
        context = injectEnvironmentData(context, validated.environment);
      }

      if (validated.instrument) {
        context = injectInstrumentSpecs(context, validated.instrument);
      }

      // Add uncertainty values to context
      // JavaScript numbers have ~15-17 significant digits of precision (IEEE 754 double).
      // We use 15 digits to stay within the safe precision range.
      // Note: GUM calculations use native Math (~15 digits), so this preserves
      // all meaningful precision from the uncertainty calculations.
      const toContextValue = (n: number) => Number(n.toPrecision(15));

      if (typeAResult) {
        context["u_typeA"] = toContextValue(typeAResult.standardUncertainty);
        context["mean"] = toContextValue(typeAResult.mean);
        context["std_dev"] = toContextValue(typeAResult.standardDeviation);
        context["n"] = typeAResult.sampleSize;
      }

      if (typeBResult) {
        context["u_typeB"] = toContextValue(typeBResult.totalTypeB);
      }

      context["u_combined"] = toContextValue(
        combinedCalc.data.combinedStandardUncertainty,
      );
      context["U_expanded"] = toContextValue(combinedCalc.data.expandedUncertainty);
      context["k"] = toContextValue(combinedCalc.data.coverageFactor);

      // Execute formulas if provided (results are chained into context)
      const formulaResults: FormulaExecutionResult[] = [];
      for (let i = 0; i < formulas.length; i++) {
        const formula = formulas[i]!;
        const result = this.evaluateFormula({
          formula,
          context,
          precision: this.config.precision,
        });
        if (result.success) {
          formulaResults.push(result.data);
          // Chain result into context for subsequent formulas
          context[`formula_${i}`] = result.data.resultAsNumber ?? result.data.result;
          this.addTrace(trace, `Formula: ${formula}`, formula, {
            contextKeys: Object.keys(context),
          }, result.data.result);
        }
      }

      // Get inputs used for traceability
      const inputsUsed = getInputsUsed(context);

      return {
        success: true,
        data: {
          typeA: typeAResult,
          typeB: typeBResult,
          combined: combinedCalc.data,
          formulaResults:
            formulaResults.length > 0 ? formulaResults : undefined,
          meta: {
            engineVersion: ENGINE_VERSION,
            timestamp: new Date().toISOString(),
            inputsUsed,
          },
          trace,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: this.classifyError(error),
          message: error instanceof Error ? error.message : String(error),
          details: error,
        },
      };
    }
  }

  // ============================================
  // Utility: Prepare context from data
  // ============================================
  prepareContext(
    data: Record<string, unknown>,
    options?: FlattenOptions,
  ): FormulaContext {
    return flattenForExecution(data, options);
  }

  // ============================================
  // Get engine version
  // ============================================
  getVersion(): string {
    return ENGINE_VERSION;
  }

  // ============================================
  // Error classification
  // ============================================
  private classifyError(error: unknown): MathEngineErrorCode {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      // Check for security violations first (highest priority)
      if (
        message.includes("security violation") ||
        message.includes("dangerous pattern")
      ) {
        return "SECURITY_VIOLATION";
      }

      // Check for formula/parsing errors
      if (
        message.includes("unexpected") ||
        message.includes("parse") ||
        message.includes("syntax") ||
        message.includes("undefined symbol") ||
        message.includes("unexpected end") ||
        message.includes("parenthesis") ||
        message.includes("operator")
      ) {
        return "FORMULA_ERROR";
      }

      // Check for precision errors
      if (message.includes("precision")) {
        return "PRECISION_ERROR";
      }

      // Check for validation errors (Zod)
      if (message.includes("zod") || message.includes("validation")) {
        return "INVALID_INPUT";
      }
    }
    return "CALCULATION_ERROR";
  }
}

// ============================================
// Factory function for convenience
// ============================================
export function createEngine(
  config?: Partial<MathEngineConfig>,
): CalibrationEngine {
  return new CalibrationEngine(config);
}
