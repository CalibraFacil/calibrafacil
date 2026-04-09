import { z } from "zod";

// ============================================
// Distribution Types for Type B Uncertainty
// ============================================
export const DistributionTypeSchema = z.enum([
  "normal",
  "rectangular",
  "triangular",
  "u-shaped",
]);
export type DistributionType = z.infer<typeof DistributionTypeSchema>;

// ============================================
// Type A Uncertainty Input (Statistical)
// ============================================
export const TypeAInputSchema = z.object({
  readings: z.array(z.number()).min(2, "At least 2 readings required"),
  degreesOfFreedom: z.number().int().positive().optional(),
});
export type TypeAInput = z.infer<typeof TypeAInputSchema>;

export const TypeAResultSchema = z.object({
  mean: z.number(),
  standardDeviation: z.number(),
  standardUncertainty: z.number(),
  degreesOfFreedom: z.number(),
  sampleSize: z.number(),
});
export type TypeAResult = z.infer<typeof TypeAResultSchema>;

// ============================================
// Type B Uncertainty Input (Systematic)
// ============================================
/**
 * Type B uncertainty component schema
 *
 * Represents a systematic uncertainty source evaluated by non-statistical methods
 * (e.g., manufacturer specifications, calibration certificates, engineering judgment).
 *
 * @property name - Identifier for this uncertainty component
 * @property value - The uncertainty value (half-width for rectangular, full value for normal)
 * @property distribution - Probability distribution assumption (default: "rectangular")
 * @property coverageFactor - If provided, value is treated as expanded uncertainty U = k * u
 * @property divisor - Custom divisor (overrides distribution-based divisor)
 * @property degreesOfFreedom - DOF for Welch-Satterthwaite calculation (default: 50)
 *
 * DEFAULT DOF RATIONALE (50):
 * GUM Section G.4.2 recommends that for Type B estimates where the uncertainty
 * is considered "reliable" (e.g., based on well-documented specifications or
 * calibration certificates), a large DOF (≥50) can be assumed. This results in
 * k ≈ 2.05, which has negligible impact on the combined coverage factor.
 *
 * For less reliable estimates (e.g., rough engineering judgment), use a smaller
 * DOF (e.g., 10-30) to account for the additional uncertainty in the estimate.
 *
 * Reference: GUM Section 4.3.5, Section G.4.2, Table G.2
 */
export const TypeBComponentSchema = z.object({
  name: z.string(),
  value: z.number().positive("Uncertainty value must be positive"),
  distribution: DistributionTypeSchema.optional().default("rectangular"),
  coverageFactor: z.number().positive().optional(),
  divisor: z.number().positive().optional(),
  degreesOfFreedom: z.number().positive().optional().default(50),
});
export type TypeBComponent = z.input<typeof TypeBComponentSchema>;
export type TypeBComponentParsed = z.output<typeof TypeBComponentSchema>;

export const TypeBResultSchema = z.object({
  components: z.array(
    z.object({
      name: z.string(),
      standardUncertainty: z.number(),
      degreesOfFreedom: z.number(),
    }),
  ),
  totalTypeB: z.number(),
});
export type TypeBResult = z.infer<typeof TypeBResultSchema>;

// ============================================
// Combined Uncertainty
// ============================================
/**
 * Combined uncertainty input schema
 *
 * IMPORTANT LIMITATION: CORRELATION ASSUMPTION
 *
 * The combined uncertainty calculation uses the simplified GUM formula
 * (GUM Equation 10):
 *
 *   u_c = √(∑ cᵢ²uᵢ²)
 *
 * This formula ASSUMES all input quantities are UNCORRELATED (r = 0).
 *
 * For correlated inputs, the full formula (GUM Equation 13) requires:
 *
 *   u_c² = ∑∑ cᵢcⱼu(xᵢ)u(xⱼ)r(xᵢ,xⱼ)
 *
 * Common sources of correlation in calibration:
 * - Multiple measurements using the same reference standard
 * - Temperature affecting multiple components
 * - Readings from instruments calibrated against the same reference
 *
 * If your calibration involves correlated quantities, you should:
 * 1. Use a Monte Carlo method (GUM Supplement 1), OR
 * 2. Document the correlation assumption in your uncertainty budget, OR
 * 3. Use a conservative estimate by assuming full correlation (r = 1)
 *
 * Reference: GUM Section 5.2, Equations 10-16
 */
export const CombinedUncertaintyInputSchema = z.object({
  typeA: TypeAResultSchema.optional(),
  typeB: TypeBResultSchema.optional(),
  sensitivityCoefficients: z.record(z.string(), z.number()).optional(),
});
export type CombinedUncertaintyInput = z.infer<
  typeof CombinedUncertaintyInputSchema
>;

export const CombinedUncertaintyResultSchema = z.object({
  combinedStandardUncertainty: z.number(),
  effectiveDegreesOfFreedom: z.number(),
  coverageFactor: z.number(),
  expandedUncertainty: z.number(),
  /** The requested confidence level */
  confidenceLevel: z.number(),
  /** The actual confidence level used (may differ if requested level not in t-tables) */
  actualConfidenceLevel: z.number(),
});
export type CombinedUncertaintyResult = z.infer<
  typeof CombinedUncertaintyResultSchema
>;

// ============================================
// Formula Execution
// ============================================
export const FormulaContextSchema = z.record(
  z.string(),
  z.union([
    z.number(),
    z.string(),
    z.boolean(),
    z.null(),
    z.array(z.number()), // Numeric arrays for direct input
    z.array(z.string()), // String arrays from formula results (preserve BigNumber precision)
  ]),
);
export type FormulaContext = z.infer<typeof FormulaContextSchema>;

export const FormulaExecutionInputSchema = z.object({
  formula: z.string().min(1, "Formula cannot be empty"),
  context: FormulaContextSchema,
  precision: z.number().int().min(1).max(128).optional().default(32),
});
export type FormulaExecutionInput = z.input<typeof FormulaExecutionInputSchema>;
export type FormulaExecutionInputParsed = z.output<
  typeof FormulaExecutionInputSchema
>;

export const FormulaExecutionResultSchema = z.object({
  // Result is stored as STRING or STRING ARRAY to preserve BigNumber precision
  // This prevents "Cannot convert >15 significant digits" errors when chaining formulas
  result: z.union([
    z.string(), // Scalar result (number converted to string for precision)
    z.array(z.string()), // Vector result (array of strings for precision)
  ]),
  // The numeric representation (for display/simple checks) - null for arrays
  resultAsNumber: z.number().nullable(),
  formula: z.string(),
  executionTimeMs: z.number(),
});
export type FormulaExecutionResult = z.infer<
  typeof FormulaExecutionResultSchema
>;

// ============================================
// Calibration Data for Flattening
// ============================================
export const CalibrationDataSchema = z.object({
  readings: z.array(z.record(z.string(), z.unknown())).optional(),
  environment: z
    .object({
      temperature: z.number().optional(),
      humidity: z.number().optional(),
      pressure: z.number().optional(),
    })
    .optional(),
  instrument: z
    .object({
      resolution: z.number().optional(),
      accuracy: z.number().optional(),
      drift: z.number().optional(),
    })
    .optional(),
  reference: z
    .object({
      uncertainty: z.number().optional(),
      coverageFactor: z.number().optional(),
    })
    .optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
});
export type CalibrationData = z.infer<typeof CalibrationDataSchema>;

// ============================================
// Calculation Trace (for audit trails and debugging)
// ============================================
/**
 * Calculation trace entry for audit trails
 *
 * When verbose mode is enabled, the engine logs each calculation step
 * with inputs, outputs, and timing information. This supports:
 * - ISO 17025 audit trails
 * - Debugging uncertainty calculations
 * - Validation of intermediate results
 */
export const CalculationTraceSchema = z.object({
  step: z.string(), // e.g., "TypeA.mean", "TypeB.resolution"
  operation: z.string(), // e.g., "sum(readings) / n"
  inputs: z.record(z.string(), z.unknown()),
  output: z.unknown(),
  timestamp: z.number(), // Unix timestamp in ms
});
export type CalculationTrace = z.infer<typeof CalculationTraceSchema>;

// ============================================
// Full Calibration Result with ISO 17025 Traceability
// ============================================
export const CalibrationResultSchema = z.object({
  typeA: TypeAResultSchema.optional(),
  typeB: TypeBResultSchema.optional(),
  combined: CombinedUncertaintyResultSchema,
  formulaResults: z.array(FormulaExecutionResultSchema).optional(),
  meta: z.object({
    engineVersion: z.string(),
    timestamp: z.string(),
    inputsUsed: z.array(z.string()),
  }),
  trace: z.array(CalculationTraceSchema).optional(),
});
export type CalibrationResult = z.infer<typeof CalibrationResultSchema>;

// ============================================
// Engine Errors
// ============================================
export const MathEngineErrorCodeSchema = z.enum([
  "INVALID_INPUT",
  "FORMULA_ERROR",
  "SECURITY_VIOLATION",
  "PRECISION_ERROR",
  "CALCULATION_ERROR",
]);
export type MathEngineErrorCode = z.infer<typeof MathEngineErrorCodeSchema>;

export const MathEngineErrorSchema = z.object({
  code: MathEngineErrorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
});
export type MathEngineError = z.infer<typeof MathEngineErrorSchema>;

// ============================================
// Unit Value (for unit normalization)
// ============================================
export const UnitValueSchema = z.object({
  value: z.number(),
  unit: z.string(),
});
export type UnitValue = z.infer<typeof UnitValueSchema>;
