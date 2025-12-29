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
    };
    this.secureMath = createSecureMath(this.config);
  }

  // ============================================
  // Formula Execution (sync only)
  // ============================================
  evaluateFormula(
    input: FormulaExecutionInput,
  ): EngineResult<FormulaExecutionResult> {
    try {
      const validated = FormulaExecutionInputSchema.parse(input);
      const startTime = performance.now();

      // Update precision if different from default
      if (validated.precision !== this.config.precision) {
        this.secureMath = createSecureMath({
          ...this.config,
          precision: validated.precision,
        });
      }

      const result = this.secureMath.evaluate(
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
  ): EngineResult<CalibrationResult> {
    try {
      const validated = CalibrationDataSchema.parse(data);

      // Extract readings for Type A
      const readings = extractReadings(validated as Record<string, unknown>);
      let typeAResult: TypeAResult | undefined;

      if (readings.length >= 2) {
        const typeACalc = this.calculateTypeA({ readings });
        if (typeACalc.success) {
          typeAResult = typeACalc.data;
        }
      }

      // Calculate Type B if components provided
      let typeBResult: TypeBResult | undefined;
      if (typeBComponents.length > 0) {
        const typeBCalc = this.calculateTypeB(typeBComponents);
        if (typeBCalc.success) {
          typeBResult = typeBCalc.data;
        }
      }

      // Calculate combined uncertainty
      const combinedCalc = this.calculateCombined(typeAResult, typeBResult);
      if (!combinedCalc.success) {
        return combinedCalc;
      }

      // Prepare context for formula execution
      let context = flattenForExecution(validated as Record<string, unknown>);

      if (validated.environment) {
        context = injectEnvironmentData(context, validated.environment);
      }

      if (validated.instrument) {
        context = injectInstrumentSpecs(context, validated.instrument);
      }

      // Add uncertainty values to context
      // Round to 14 significant digits to avoid BigNumber conversion errors
      const round = (n: number) => Number(n.toPrecision(14));

      if (typeAResult) {
        context["u_typeA"] = round(typeAResult.standardUncertainty);
        context["mean"] = round(typeAResult.mean);
        context["std_dev"] = round(typeAResult.standardDeviation);
        context["n"] = typeAResult.sampleSize;
      }

      if (typeBResult) {
        context["u_typeB"] = round(typeBResult.totalTypeB);
      }

      context["u_combined"] = round(
        combinedCalc.data.combinedStandardUncertainty,
      );
      context["U_expanded"] = round(combinedCalc.data.expandedUncertainty);
      context["k"] = round(combinedCalc.data.coverageFactor);

      // Execute formulas if provided
      const formulaResults: FormulaExecutionResult[] = [];
      for (const formula of formulas) {
        const result = this.evaluateFormula({
          formula,
          context,
          precision: this.config.precision,
        });
        if (result.success) {
          formulaResults.push(result.data);
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
