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
  confidenceLevel: z.number(),
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
    z.array(z.number()), // Allow numeric arrays for vector operations (mean, std, etc.)
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
  result: z.union([z.number(), z.string()]),
  resultAsNumber: z.number(),
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
