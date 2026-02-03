// Main engine
export { CalibrationEngine, createEngine } from "./engine";
export type { EngineResult } from "./engine";

// Configuration
export { createSecureMath, getSecureMath, resetSecureMath } from "./config";
export type { MathEngineConfig, SecureMath } from "./config";

// GUM calculations
export {
  calculateTypeA,
  calculateTypeB,
  calculateCombinedUncertainty,
} from "./gum";

// Data utilities
export {
  flattenForExecution,
  extractReadings,
  injectEnvironmentData,
  injectInstrumentSpecs,
  getInputsUsed,
  parseUnitValue,
  normalizeToSI,
} from "./flatten";
export type { FlattenOptions } from "./flatten";

// Constants
export {
  ENGINE_VERSION,
  DISTRIBUTION_DIVISORS,
  COVERAGE_FACTORS,
  T_TABLE,
  T_TABLE_95,
  T_TABLE_95_45,
  T_TABLE_99,
  T_TABLES,
  T_INFINITY,
  SUPPORTED_CONFIDENCE_LEVELS,
  INCLUDE_KEYS,
  EXCLUDE_KEYS,
  UNIT_TO_SI,
} from "./constants";
export type { SupportedConfidenceLevel } from "./constants";

// Types and schemas
export {
  // Schemas
  DistributionTypeSchema,
  TypeAInputSchema,
  TypeAResultSchema,
  TypeBComponentSchema,
  TypeBResultSchema,
  CombinedUncertaintyInputSchema,
  CombinedUncertaintyResultSchema,
  FormulaContextSchema,
  FormulaExecutionInputSchema,
  FormulaExecutionResultSchema,
  CalibrationDataSchema,
  CalibrationResultSchema,
  MathEngineErrorSchema,
  MathEngineErrorCodeSchema,
  UnitValueSchema,
} from "./types";

export type {
  DistributionType,
  TypeAInput,
  TypeAResult,
  TypeBComponent,
  TypeBResult,
  CombinedUncertaintyInput,
  CombinedUncertaintyResult,
  FormulaContext,
  FormulaExecutionInput,
  FormulaExecutionResult,
  CalibrationData,
  CalibrationResult,
  CalculationTrace,
  MathEngineError,
  MathEngineErrorCode,
  UnitValue,
} from "./types";
