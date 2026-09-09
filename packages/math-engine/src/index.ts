export { createCalculationEngine } from "./engine/create.js";
export type { CalculationEngine } from "./engine/create.js";
export {
  ENGINE_VERSION,
  METHOD_ENGINE_OPTIONS,
  normalizeEngineOptions,
} from "./engine/options.js";
export type {
  AngleMode,
  CalculationEngineOptions,
  NormalizedCalculationEngineOptions,
} from "./engine/options.js";

export {
  CalculationEngineError,
  ERROR_CODES,
  isCalculationEngineError,
  makeError,
} from "./errors/index.js";
export type {
  CalculationErrorCode,
  CalculationErrorDetails,
  StructuredCalculationError,
} from "./errors/index.js";

export type {
  CompileFormulaOptions,
  CompiledFormula,
  CompiledFormulaMetadata,
  FormulaEvaluationOptions,
  FormulaEvaluationResult,
} from "./formula/compiled.js";
export type {
  CalculationDiagnostic,
  DiagnosticSeverity,
} from "./formula/index.js";

export type {
  BinaryOperator,
  CallExpressionNode,
  FormulaAstNode,
  FormulaLimits,
  NumberLiteralNode,
  SafeFunctionName,
  Token,
  TokenType,
  UnaryExpressionNode,
  UnaryOperator,
  VariableNode,
} from "./parser/index.js";

export type {
  NumericBackend,
  NumericInput,
  NumericMode,
  NumericOptions,
  NumericOutput,
} from "./numeric/index.js";

export type { CanonicalJsonValue } from "./audit/index.js";
export {
  canonicalJson,
  fingerprintCanonical,
  fingerprintText,
  stableHash,
} from "./audit/index.js";

export {
  coverageFactorForProbability,
  erf,
  logGamma,
  mean,
  normalQuantile,
  regularizedIncompleteBeta,
  sampleStandardDeviation,
  standardUncertaintyOfMean,
  studentTCdf,
  studentTQuantile,
  welchSatterthwaiteDegreesOfFreedom,
  generalizedWelchSatterthwaiteDegreesOfFreedom,
} from "./gum/index.js";
export type {
  AuditMetadataValue,
  InputQuantity,
  MeasurementModelInput,
  CorrelatedDegreesOfFreedomPolicy,
  MeasurementModelResult,
  PairwiseCorrelation,
  PairwiseCorrelationObject,
  PairwiseCovariance,
  PairwiseCovarianceObject,
  PairwiseMatrixInput,
  QuantityDegreesOfFreedom,
  QuantityMetadata,
  UncertaintyBudgetEntry,
} from "./gum/index.js";

export {
  assertSupportedTypeBDistribution,
  typeAFromRepeatedObservations,
  typeBStandardUncertainty,
} from "./uncertainty/index.js";
export type {
  TypeAUncertaintyResult,
  TypeBDistribution,
  TypeBStandardUncertaintyInput,
  TypeBUncertaintyResult,
} from "./uncertainty/index.js";

export type { UnitLabel } from "./units/index.js";
