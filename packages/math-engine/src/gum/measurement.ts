import type { CanonicalJsonValue } from "../audit/canonical-json.js";
import { canonicalJson } from "../audit/canonical-json.js";
import { fingerprintText } from "../audit/fingerprint.js";
import { evaluateAst } from "../evaluator/evaluate.js";
import { ERROR_CODES } from "../errors/codes.js";
import { makeError } from "../errors/errors.js";
import type { CalculationDiagnostic } from "../formula/diagnostics.js";
import { numericalDerivative, symbolicDerivative } from "../formula/derivative.js";
import { CompiledFormula, compileFormulaInternal, isCompiledFormula } from "../formula/compiled.js";
import { DecimalBackend, NumberBackend } from "../numeric/backend.js";
import type { NumericInput, NumericOutput } from "../numeric/types.js";
import { safeNumberFromInput, validateNumericInput } from "../numeric/validation.js";
import { assertSafeIdentifier, assertSafeIdentifierRecord } from "../parser/identifiers.js";
import type { FormulaAstNode, SafeFunctionName } from "../parser/ast.js";
import type { NormalizedCalculationEngineOptions } from "../engine/options.js";
import type { TypeBDistribution, TypeBStandardUncertaintyInput } from "../uncertainty/type-b.js";
import { assertSupportedTypeBDistribution, typeBStandardUncertainty } from "../uncertainty/type-b.js";
import { typeAFromRepeatedObservations, type TypeAUncertaintyResult } from "../uncertainty/type-a.js";
import type { NumericValidationOptionSubset } from "../uncertainty/type-a.js";
import { coverageFactorForProbability, welchSatterthwaiteDegreesOfFreedom } from "./statistics.js";
import { assertAllowedKeys, assertBoolean, assertDenseArray, assertNoDangerousKeys, assertPlainRecord, assertString, deepFreezeJsonLike, hasOwn, isDangerousKey, valueKind } from "../validation/shape.js";

export type AuditMetadataValue = string | number | boolean | null;
export type QuantityDegreesOfFreedom = NumericInput | "Infinity";

export interface QuantityMetadata {
  readonly [key: string]: AuditMetadataValue | undefined;
}

export interface InputQuantity {
  readonly estimate?: NumericInput;
  readonly value?: NumericInput;
  readonly unit?: string;
  readonly standardUncertainty?: NumericInput;
  readonly degreesOfFreedom?: QuantityDegreesOfFreedom;
  readonly distribution?: TypeBDistribution;
  readonly sensitivityCoefficient?: NumericInput;
  readonly repeatedObservations?: readonly NumericInput[];
  readonly typeB?: TypeBStandardUncertaintyInput;
  readonly halfWidth?: NumericInput;
  readonly lowerLimit?: NumericInput;
  readonly upperLimit?: NumericInput;
  readonly expandedUncertainty?: NumericInput;
  readonly coverageFactor?: NumericInput;
  readonly source?: string;
  readonly certificateId?: string;
  readonly calibrationDate?: string;
  readonly notes?: string;
  readonly metadata?: QuantityMetadata;
}

export interface PairwiseCorrelationObject {
  readonly symbols: readonly [string, string];
  readonly coefficient?: NumericInput;
  readonly correlation?: NumericInput;
}

export interface PairwiseCovarianceObject {
  readonly symbols: readonly [string, string];
  readonly covariance: NumericInput;
}

export type PairwiseCorrelation = readonly [string, string, NumericInput] | PairwiseCorrelationObject;
export type PairwiseCovariance = readonly [string, string, NumericInput] | PairwiseCovarianceObject;
export type PairwiseMatrixInput = Readonly<Record<string, Readonly<Record<string, NumericInput>>>>;

export interface MeasurementModelInput {
  readonly formula: string | CompiledFormula;
  readonly quantities: Readonly<Record<string, InputQuantity>>;
  readonly correlations?: readonly PairwiseCorrelation[] | PairwiseMatrixInput;
  readonly covariances?: readonly PairwiseCovariance[] | PairwiseMatrixInput;
  readonly coverageProbability?: number;
  readonly coverageFactor?: NumericInput;
  readonly allowNonSmoothWithExplicitSensitivities?: boolean;
}

export interface UncertaintyBudgetEntry {
  readonly symbol: string;
  readonly estimate: NumericOutput;
  readonly standardUncertainty: NumericOutput;
  readonly sensitivityCoefficient: NumericOutput;
  readonly contributionVariance: NumericOutput;
  readonly contributionPercent: NumericOutput;
  readonly degreesOfFreedom: NumericOutput | "Infinity";
  readonly distribution?: TypeBDistribution;
  readonly unit?: string;
  readonly metadata?: QuantityMetadata;
}

export interface MeasurementModelResult {
  readonly value: NumericOutput;
  readonly combinedStandardUncertainty: NumericOutput;
  readonly expandedUncertainty: NumericOutput;
  readonly coverageFactor: NumericOutput;
  readonly coverageProbability: number;
  readonly effectiveDegreesOfFreedom: NumericOutput | "Infinity";
  readonly sensitivityCoefficients: Record<string, NumericOutput>;
  readonly uncertaintyBudget: readonly UncertaintyBudgetEntry[];
  readonly diagnostics: readonly CalculationDiagnostic[];
  readonly formulaFingerprint: string;
  readonly calculationFingerprint: string;
  readonly canonicalResultJson: string;
  readonly normalizedFormula: string;
  readonly normalizedAst: string;
}

interface ResolvedQuantity {
  readonly symbol: string;
  readonly estimateInput: NumericInput;
  readonly estimateOutput: NumericOutput;
  readonly estimateCanonical: string;
  readonly standardUncertainty: number;
  readonly degreesOfFreedom: number;
  readonly distribution: TypeBDistribution;
  readonly unit?: string;
  readonly sensitivityCoefficient?: number;
  readonly typeA?: TypeAUncertaintyResult;
  readonly metadata?: QuantityMetadata;
}

interface PairIndexes {
  readonly i: number;
  readonly j: number;
  readonly key: string;
  readonly symbolA: string;
  readonly symbolB: string;
}

interface RelationshipEntry {
  readonly key: string;
  readonly symbolA: string;
  readonly symbolB: string;
  readonly i: number;
  readonly j: number;
  readonly value: number;
  readonly source: "correlation" | "covariance";
}

const NON_SMOOTH_FUNCTIONS: ReadonlySet<SafeFunctionName> = new Set(["abs", "floor", "ceil", "round", "min", "max"]);
const MEASUREMENT_MODEL_INPUT_KEYS = new Set([
  "formula",
  "quantities",
  "correlations",
  "covariances",
  "coverageProbability",
  "coverageFactor",
  "allowNonSmoothWithExplicitSensitivities"
]);

function numericLimits(options: NormalizedCalculationEngineOptions, label: string, requireNumberSafeForDouble = false) {
  return {
    maxExponentMagnitude: options.maxExponentMagnitude,
    maxInputLength: options.maxNumericInputLength,
    maxSignificantDigits: options.maxSignificantDigits,
    label,
    requireNumberSafeForDouble
  };
}

function numericInputToNumber(value: NumericInput, label: string, options: NormalizedCalculationEngineOptions, requireSafe = false): number {
  return safeNumberFromInput(value, numericLimits(options, label, requireSafe));
}

function parseDegreesOfFreedom(value: QuantityDegreesOfFreedom | undefined, fallback: number, options: NormalizedCalculationEngineOptions, label: string): number {
  if (value === undefined) return fallback;
  if (value === "Infinity" || value === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  const parsed = numericInputToNumber(value, label, options);
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  if (!(parsed > 0)) {
    throw makeError(ERROR_CODES.INVALID_UNCERTAINTY, "Degrees of freedom must be positive or Infinity.", { path: label, value: parsed });
  }
  return parsed;
}

function assertFiniteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw makeError(ERROR_CODES.INVALID_UNCERTAINTY, `${label} must be finite and non-negative.`, { path: label, value });
  }
  return value;
}

function getEstimateInput(quantity: InputQuantity): NumericInput | undefined {
  return quantity.estimate ?? quantity.value;
}

function assertSafeMetadataPrimitive(value: unknown, path: string): AuditMetadataValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw makeError(ERROR_CODES.INVALID_METADATA, "Metadata numbers must be finite.", { path, value: String(value) });
    }
    return Object.is(value, -0) ? 0 : value;
  }
  throw makeError(ERROR_CODES.INVALID_METADATA, "Metadata values must be string, finite number, boolean, or null.", {
    path,
    valueType: valueKind(value),
    suggestedRemediation: "Keep core audit metadata flat and JSON-serializable. Nested objects, arrays, functions, symbols, and undefined are not accepted."
  });
}

function copyOptionalMetadataString(metadata: Record<string, AuditMetadataValue>, key: string, value: unknown, path: string): void {
  if (value === undefined) return;
  metadata[key] = assertString(value, path, ERROR_CODES.INVALID_METADATA);
}

function metadataForQuantity(quantity: InputQuantity, symbol: string): QuantityMetadata | undefined {
  const metadata: Record<string, AuditMetadataValue> = Object.create(null) as Record<string, AuditMetadataValue>;
  copyOptionalMetadataString(metadata, "source", quantity.source, `${symbol}.source`);
  copyOptionalMetadataString(metadata, "certificateId", quantity.certificateId, `${symbol}.certificateId`);
  copyOptionalMetadataString(metadata, "calibrationDate", quantity.calibrationDate, `${symbol}.calibrationDate`);
  copyOptionalMetadataString(metadata, "notes", quantity.notes, `${symbol}.notes`);
  if (quantity.metadata !== undefined) {
    const metadataRecord = assertPlainRecord(quantity.metadata, `${symbol}.metadata`, ERROR_CODES.INVALID_METADATA, "Quantity metadata must be a flat plain object.");
    assertNoDangerousKeys(metadataRecord, `${symbol}.metadata`, ERROR_CODES.INVALID_METADATA);
    for (const key of Object.keys(metadataRecord).sort()) {
      if (isDangerousKey(key)) {
        throw makeError(ERROR_CODES.INVALID_METADATA, "Metadata contains an unsafe key.", { path: `${symbol}.metadata.${key}`, key });
      }
      metadata[key] = assertSafeMetadataPrimitive(metadataRecord[key], `${symbol}.metadata.${key}`);
    }
  }
  return Object.keys(metadata).length === 0 ? undefined : deepFreezeJsonLike(metadata);
}

function canonicalizeEstimate(value: NumericInput, options: NormalizedCalculationEngineOptions, label: string): { input: NumericInput; output: NumericOutput; canonical: string } {
  if (options.numericMode === "number") {
    const backend = new NumberBackend(options.decimalPrecision, options.maxExponentMagnitude, options.maxNumericInputLength, options.maxSignificantDigits);
    const parsed = backend.fromInput(value, label);
    return { input: parsed, output: backend.toOutput(parsed), canonical: backend.toCanonicalString(parsed) };
  }
  const backend = new DecimalBackend(options.decimalPrecision, options.maxExponentMagnitude, options.maxNumericInputLength, options.maxSignificantDigits);
  const parsed = backend.fromInput(value, label);
  const canonical = backend.toCanonicalString(parsed);
  return { input: value, output: backend.toOutput(parsed), canonical };
}

const ALLOWED_QUANTITY_FIELDS = new Set([
  "estimate",
  "value",
  "unit",
  "standardUncertainty",
  "degreesOfFreedom",
  "distribution",
  "sensitivityCoefficient",
  "repeatedObservations",
  "typeB",
  "halfWidth",
  "lowerLimit",
  "upperLimit",
  "expandedUncertainty",
  "coverageFactor",
  "source",
  "certificateId",
  "calibrationDate",
  "notes",
  "metadata"
]);

const TYPE_B_SOURCE_FIELDS = ["standardUncertainty", "halfWidth", "lowerLimit", "upperLimit", "expandedUncertainty", "coverageFactor", "divisor"] as const;

function assertQuantityShape(value: unknown, symbol: string): InputQuantity {
  const quantity = assertPlainRecord(value, `quantities.${symbol}`, ERROR_CODES.INVALID_QUANTITY, "Each quantity must be a plain object.");
  assertNoDangerousKeys(quantity, `quantities.${symbol}`, ERROR_CODES.INVALID_QUANTITY);
  for (const key of Object.keys(quantity)) {
    if (!ALLOWED_QUANTITY_FIELDS.has(key)) {
      throw makeError(ERROR_CODES.INVALID_QUANTITY, "Quantity contains an unsupported field.", { path: `quantities.${symbol}.${key}`, symbol, field: key });
    }
  }
  if (hasOwn(quantity, "unit")) assertString(quantity.unit, `${symbol}.unit`, ERROR_CODES.INVALID_QUANTITY);
  for (const key of ["source", "certificateId", "calibrationDate", "notes"] as const) {
    if (hasOwn(quantity, key)) assertString(quantity[key], `${symbol}.${key}`, ERROR_CODES.INVALID_METADATA);
  }
  if (hasOwn(quantity, "metadata")) {
    assertPlainRecord(quantity.metadata, `${symbol}.metadata`, ERROR_CODES.INVALID_METADATA, "Quantity metadata must be a flat plain object.");
  }
  if (hasOwn(quantity, "repeatedObservations")) {
    if (!Array.isArray(quantity.repeatedObservations)) {
      throw makeError(ERROR_CODES.INVALID_QUANTITY, "repeatedObservations must be an array.", { path: `quantities.${symbol}.repeatedObservations`, valueType: valueKind(quantity.repeatedObservations) });
    }
    assertDenseArray(quantity.repeatedObservations, `quantities.${symbol}.repeatedObservations`, ERROR_CODES.INVALID_QUANTITY);
  }
  if (hasOwn(quantity, "typeB")) {
    assertPlainRecord(quantity.typeB, `${symbol}.typeB`, ERROR_CODES.INVALID_INPUT_SHAPE, "Quantity typeB must be a plain object.");
  }
  if (!hasOwn(quantity, "estimate") && !hasOwn(quantity, "value") && !hasOwn(quantity, "repeatedObservations")) {
    throw makeError(ERROR_CODES.INVALID_QUANTITY, "Quantity estimate, value, or repeatedObservations is required.", { path: `quantities.${symbol}.estimate`, symbol });
  }
  return quantity as InputQuantity;
}

function quantityHasExternalTypeBSource(quantity: InputQuantity): boolean {
  return quantity.halfWidth !== undefined || quantity.lowerLimit !== undefined || quantity.upperLimit !== undefined || quantity.expandedUncertainty !== undefined || quantity.coverageFactor !== undefined;
}

function typeBRecordHasSource(typeB: TypeBStandardUncertaintyInput | undefined): boolean {
  if (typeB === undefined) return false;
  const record = typeB as unknown as Record<string, unknown>;
  return TYPE_B_SOURCE_FIELDS.some((field) => hasOwn(record, field));
}

function resolveDistribution(quantity: InputQuantity, symbol: string): TypeBDistribution {
  const outer = quantity.distribution === undefined ? undefined : assertSupportedTypeBDistribution(quantity.distribution, `${symbol}.distribution`);
  const typeBDistribution = quantity.typeB?.distribution === undefined ? undefined : assertSupportedTypeBDistribution(quantity.typeB.distribution, `${symbol}.typeB.distribution`);
  if (outer !== undefined && typeBDistribution !== undefined && outer !== typeBDistribution) {
    throw makeError(ERROR_CODES.INVALID_TYPE_B_CONFIGURATION, "Quantity distribution and typeB.distribution must not conflict.", {
      path: `${symbol}.distribution`,
      distribution: outer,
      typeBDistribution
    });
  }
  return outer ?? typeBDistribution ?? "custom";
}

function numericValidationOptionsFromEngine(options: NormalizedCalculationEngineOptions): NumericValidationOptionSubset {
  return {
    decimalPrecision: options.decimalPrecision,
    maxExponentMagnitude: options.maxExponentMagnitude,
    maxNumericInputLength: options.maxNumericInputLength,
    maxSignificantDigits: options.maxSignificantDigits
  };
}

function resolveQuantity(symbol: string, quantity: InputQuantity, options: NormalizedCalculationEngineOptions): ResolvedQuantity {
  const helperOptions = numericValidationOptionsFromEngine(options);
  let typeA: TypeAUncertaintyResult | undefined;
  if (quantity.repeatedObservations !== undefined) {
    typeA = typeAFromRepeatedObservations(quantity.repeatedObservations, helperOptions);
  }

  const estimateInput = getEstimateInput(quantity) ?? typeA?.mean;
  if (estimateInput === undefined) {
    throw makeError(ERROR_CODES.INVALID_QUANTITY, "Quantity estimate is required and must be finite.", { symbol, path: `${symbol}.estimate` });
  }
  validateNumericInput(estimateInput, numericLimits(options, `${symbol}.estimate`));
  const estimate = canonicalizeEstimate(estimateInput, options, `${symbol}.estimate`);

  let standardUncertainty: number;
  let distribution: TypeBDistribution = resolveDistribution(quantity, symbol);
  if (quantity.standardUncertainty !== undefined) {
    if (quantityHasExternalTypeBSource(quantity) || typeBRecordHasSource(quantity.typeB)) {
      throw makeError(ERROR_CODES.INVALID_TYPE_B_CONFIGURATION, "standardUncertainty must not be combined with Type B source fields on the same quantity.", {
        path: `${symbol}.standardUncertainty`,
        symbol
      });
    }
    standardUncertainty = numericInputToNumber(quantity.standardUncertainty, `${symbol}.standardUncertainty`, options);
  } else if (typeA !== undefined && !quantityHasExternalTypeBSource(quantity) && !typeBRecordHasSource(quantity.typeB)) {
    standardUncertainty = typeA.standardUncertainty;
    distribution = quantity.distribution === undefined && quantity.typeB?.distribution === undefined ? "normal" : distribution;
  } else if (quantity.typeB !== undefined || quantity.distribution !== undefined || quantityHasExternalTypeBSource(quantity)) {
    if (quantity.typeB !== undefined && quantityHasExternalTypeBSource(quantity) && typeBRecordHasSource(quantity.typeB)) {
      throw makeError(ERROR_CODES.INVALID_TYPE_B_CONFIGURATION, "Do not split Type B source fields between quantity-level fields and quantity.typeB.", {
        path: `${symbol}.typeB`,
        symbol
      });
    }
    const typeBBase = quantity.typeB === undefined ? {} : quantity.typeB;
    const typeBInput: TypeBStandardUncertaintyInput = {
      ...(typeBBase as TypeBStandardUncertaintyInput),
      distribution,
      ...(quantity.halfWidth === undefined ? {} : { halfWidth: quantity.halfWidth }),
      ...(quantity.lowerLimit === undefined ? {} : { lowerLimit: quantity.lowerLimit }),
      ...(quantity.upperLimit === undefined ? {} : { upperLimit: quantity.upperLimit }),
      ...(quantity.expandedUncertainty === undefined ? {} : { expandedUncertainty: quantity.expandedUncertainty }),
      ...(quantity.coverageFactor === undefined ? {} : { coverageFactor: quantity.coverageFactor })
    };
    const typeB = typeBStandardUncertainty(typeBInput, helperOptions);
    standardUncertainty = typeB.standardUncertainty;
    distribution = typeB.distribution;
  } else {
    throw makeError(ERROR_CODES.INVALID_UNCERTAINTY, "Quantity standard uncertainty is required.", { symbol, path: `${symbol}.standardUncertainty` });
  }

  standardUncertainty = assertFiniteNonNegative(standardUncertainty, `${symbol}.standardUncertainty`);
  const degreesOfFreedom = parseDegreesOfFreedom(quantity.degreesOfFreedom, typeA === undefined ? Number.POSITIVE_INFINITY : typeA.degreesOfFreedom, options, `${symbol}.degreesOfFreedom`);
  const sensitivityCoefficient = quantity.sensitivityCoefficient === undefined
    ? undefined
    : numericInputToNumber(quantity.sensitivityCoefficient, `${symbol}.sensitivityCoefficient`, options);
  if (sensitivityCoefficient !== undefined && !Number.isFinite(sensitivityCoefficient)) {
    throw makeError(ERROR_CODES.INVALID_INPUT, "Sensitivity coefficient must be finite.", { symbol, path: `${symbol}.sensitivityCoefficient` });
  }

  const metadata = metadataForQuantity(quantity, symbol);
  return {
    symbol,
    estimateInput: estimate.input,
    estimateOutput: estimate.output,
    estimateCanonical: estimate.canonical,
    standardUncertainty,
    degreesOfFreedom,
    distribution,
    ...(quantity.unit === undefined ? {} : { unit: quantity.unit }),
    ...(sensitivityCoefficient === undefined ? {} : { sensitivityCoefficient }),
    ...(typeA === undefined ? {} : { typeA }),
    ...(metadata === undefined ? {} : { metadata })
  };
}

function quantityCanonical(quantity: ResolvedQuantity): CanonicalJsonValue {
  return {
    symbol: quantity.symbol,
    estimate: quantity.estimateCanonical,
    standardUncertainty: quantity.standardUncertainty,
    degreesOfFreedom: Number.isFinite(quantity.degreesOfFreedom) ? quantity.degreesOfFreedom : "Infinity",
    distribution: quantity.distribution,
    unit: quantity.unit,
    sensitivityCoefficient: quantity.sensitivityCoefficient,
    metadata: quantity.metadata as CanonicalJsonValue | undefined
  };
}

function resolveCompiledFormula(formula: unknown, symbols: readonly string[], options: NormalizedCalculationEngineOptions): CompiledFormula {
  if (typeof formula === "string") {
    return compileFormulaInternal(formula, options, { allowedVariables: symbols });
  }
  if (!isCompiledFormula(formula)) {
    throw makeError(ERROR_CODES.INVALID_INPUT_SHAPE, "Measurement model formula must be a string or a CompiledFormula created by this package.", {
      path: "formula",
      valueType: valueKind(formula)
    });
  }
  formula.assertCompatibleWithOptions(options);
  const symbolSet = new Set(symbols);
  for (const variable of formula.variables) {
    if (!symbolSet.has(variable)) {
      throw makeError(ERROR_CODES.UNKNOWN_IDENTIFIER, "Compiled formula references a variable not present in quantities.", { identifier: variable, variable, path: `formula.variables.${variable}` });
    }
  }
  return formula;
}

function outputNumber(value: number, options: NormalizedCalculationEngineOptions): NumericOutput {
  if (options.numericMode === "number") {
    const backend = new NumberBackend(options.decimalPrecision, options.maxExponentMagnitude, options.maxNumericInputLength, options.maxSignificantDigits);
    return backend.toOutput(backend.fromNumber(value, "output"));
  }
  const backend = new DecimalBackend(options.decimalPrecision, options.maxExponentMagnitude, options.maxNumericInputLength, options.maxSignificantDigits);
  return backend.toOutput(backend.fromNumber(value, "output"));
}

function outputDegreesOfFreedom(value: number, options: NormalizedCalculationEngineOptions): NumericOutput | "Infinity" {
  return Number.isFinite(value) ? outputNumber(value, options) : "Infinity";
}

function createZeroMatrix(size: number): number[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
}

function pairKey(symbolA: string, symbolB: string): string {
  return symbolA < symbolB ? `${symbolA}\u0000${symbolB}` : `${symbolB}\u0000${symbolA}`;
}

function assertRelationshipSymbol(value: unknown, path: string, symbolToIndex: ReadonlyMap<string, number>): string {
  if (typeof value !== "string") {
    throw makeError(ERROR_CODES.INVALID_RELATIONSHIP, "Relationship symbol must be a string.", { path, valueType: valueKind(value) });
  }
  assertSafeIdentifier(value, 1024);
  if (!symbolToIndex.has(value)) {
    throw makeError(ERROR_CODES.UNKNOWN_RELATIONSHIP_SYMBOL, "Correlation or covariance references an unknown quantity.", { path, symbol: value });
  }
  return value;
}

function validatePair(symbolAInput: unknown, symbolBInput: unknown, symbolToIndex: ReadonlyMap<string, number>, path: string, allowDiagonal: boolean): PairIndexes {
  const symbolA = assertRelationshipSymbol(symbolAInput, `${path}.symbols[0]`, symbolToIndex);
  const symbolB = assertRelationshipSymbol(symbolBInput, `${path}.symbols[1]`, symbolToIndex);
  if (!allowDiagonal && symbolA === symbolB) {
    throw makeError(ERROR_CODES.INVALID_RELATIONSHIP, "Pairwise relationship symbols must reference two different quantities.", { path, symbols: [symbolA, symbolB] });
  }
  const i = symbolToIndex.get(symbolA);
  const j = symbolToIndex.get(symbolB);
  if (i === undefined || j === undefined) {
    throw makeError(ERROR_CODES.UNKNOWN_RELATIONSHIP_SYMBOL, "Correlation or covariance references an unknown quantity.", { path, symbolA, symbolB });
  }
  return { i, j, key: pairKey(symbolA, symbolB), symbolA, symbolB };
}

function assertAlmostSame(existing: RelationshipEntry, next: RelationshipEntry, tolerance: number): void {
  if (Math.abs(existing.value - next.value) > tolerance) {
    throw makeError(ERROR_CODES.DUPLICATE_RELATIONSHIP, "Duplicate correlation/covariance relationship has conflicting values.", {
      path: `${next.source}(${next.symbolA},${next.symbolB})`,
      pair: [next.symbolA, next.symbolB],
      firstValue: existing.value,
      secondValue: next.value,
      source: next.source
    });
  }
}

function assertRelationshipSymbols(value: unknown, path: string, symbolToIndex: ReadonlyMap<string, number>, allowDiagonal: boolean): PairIndexes {
  if (!Array.isArray(value) || value.length !== 2) {
    throw makeError(ERROR_CODES.INVALID_RELATIONSHIP, "Relationship symbols must be an array with exactly two entries.", {
      path,
      valueType: valueKind(value),
      actualLength: Array.isArray(value) ? value.length : undefined
    });
  }
  assertDenseArray(value, path, ERROR_CODES.INVALID_RELATIONSHIP);
  return validatePair(value[0], value[1], symbolToIndex, path, allowDiagonal);
}

function assertNoUnsupportedRelationshipKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw makeError(ERROR_CODES.INVALID_RELATIONSHIP, "Relationship object contains an unsupported field.", { path: `${path}.${key}`, field: key });
    }
  }
}

function collectRelationships(
  input: MeasurementModelInput["correlations"] | MeasurementModelInput["covariances"],
  source: "correlation" | "covariance",
  symbolToIndex: ReadonlyMap<string, number>,
  options: NormalizedCalculationEngineOptions
): Map<string, RelationshipEntry> {
  const map = new Map<string, RelationshipEntry>();
  if (input === undefined) return map;

  const apply = (pair: PairIndexes, valueInput: NumericInput, valuePath: string): void => {
    const value = numericInputToNumber(valueInput, valuePath, options);
    if (source === "correlation" && !(value >= -1 && value <= 1)) {
      throw makeError(ERROR_CODES.INVALID_CORRELATION, "Correlation coefficients must be between -1 and 1.", { path: valuePath, symbolA: pair.symbolA, symbolB: pair.symbolB, coefficient: value });
    }
    if (!Number.isFinite(value)) {
      throw makeError(ERROR_CODES.INVALID_UNCERTAINTY, "Covariance/correlation must be finite.", { path: valuePath, symbolA: pair.symbolA, symbolB: pair.symbolB, value });
    }
    const entry: RelationshipEntry = { key: pair.key, symbolA: pair.symbolA, symbolB: pair.symbolB, i: pair.i, j: pair.j, value, source };
    const existing = map.get(pair.key);
    if (existing !== undefined) assertAlmostSame(existing, entry, options.covarianceMatrixTolerance);
    else map.set(pair.key, entry);
  };

  const parseObjectEntry = (entry: unknown, index: number): void => {
    const path = `${source}s[${index}]`;
    const record = assertPlainRecord(entry, path, ERROR_CODES.INVALID_RELATIONSHIP, "Relationship entry must be a tuple or plain object.");
    assertNoDangerousKeys(record, path, ERROR_CODES.INVALID_RELATIONSHIP);
    const pair = assertRelationshipSymbols(record.symbols, `${path}.symbols`, symbolToIndex, false);
    if (source === "correlation") {
      if (hasOwn(record, "covariance")) {
        throw makeError(ERROR_CODES.CONFLICTING_RELATIONSHIP_FIELDS, "Correlation entries must not contain covariance.", { path: `${path}.covariance` });
      }
      const hasCoefficient = hasOwn(record, "coefficient");
      const hasCorrelation = hasOwn(record, "correlation");
      if (hasCoefficient && hasCorrelation) {
        throw makeError(ERROR_CODES.CONFLICTING_RELATIONSHIP_FIELDS, "Correlation entry must use exactly one of coefficient or correlation.", { path });
      }
      if (!hasCoefficient && !hasCorrelation) {
        throw makeError(ERROR_CODES.INVALID_RELATIONSHIP, "Correlation entry requires coefficient or correlation.", { path });
      }
      assertNoUnsupportedRelationshipKeys(record, new Set(["symbols", hasCoefficient ? "coefficient" : "correlation"]), path);
      apply(pair, (hasCoefficient ? record.coefficient : record.correlation) as NumericInput, `${path}.${hasCoefficient ? "coefficient" : "correlation"}`);
      return;
    }

    if (hasOwn(record, "coefficient") || hasOwn(record, "correlation")) {
      throw makeError(ERROR_CODES.CONFLICTING_RELATIONSHIP_FIELDS, "Covariance entries must not contain coefficient or correlation.", { path });
    }
    if (!hasOwn(record, "covariance")) {
      throw makeError(ERROR_CODES.INVALID_RELATIONSHIP, "Covariance entry requires covariance.", { path });
    }
    assertNoUnsupportedRelationshipKeys(record, new Set(["symbols", "covariance"]), path);
    apply(pair, record.covariance as NumericInput, `${path}.covariance`);
  };

  if (Array.isArray(input)) {
    assertDenseArray(input, `${source}s`, ERROR_CODES.INVALID_RELATIONSHIP);
    for (let index = 0; index < input.length; index += 1) {
      const entry = input[index];
      if (Array.isArray(entry)) {
        const path = `${source}s[${index}]`;
        if (entry.length !== 3) {
          throw makeError(ERROR_CODES.INVALID_RELATIONSHIP, "Tuple relationship entries must have exactly three elements.", { path, actualLength: entry.length });
        }
        assertDenseArray(entry, path, ERROR_CODES.INVALID_RELATIONSHIP);
        const pair = validatePair(entry[0], entry[1], symbolToIndex, path, false);
        apply(pair, entry[2] as NumericInput, `${path}[2]`);
      } else {
        parseObjectEntry(entry, index);
      }
    }
  } else {
    const matrix = assertPlainRecord(input, `${source}s`, ERROR_CODES.INVALID_RELATIONSHIP, "Relationship matrix must be a plain object.") as PairwiseMatrixInput;
    assertNoDangerousKeys(matrix as unknown as Record<string, unknown>, `${source}s`, ERROR_CODES.INVALID_RELATIONSHIP);
    for (const symbolA of Object.keys(matrix).sort()) {
      assertRelationshipSymbol(symbolA, `${source}s.${symbolA}`, symbolToIndex);
      const row = matrix[symbolA];
      const rowRecord = assertPlainRecord(row, `${source}s.${symbolA}`, ERROR_CODES.INVALID_RELATIONSHIP, "Relationship matrix row must be a plain object.");
      assertNoDangerousKeys(rowRecord, `${source}s.${symbolA}`, ERROR_CODES.INVALID_RELATIONSHIP);
      for (const symbolB of Object.keys(rowRecord).sort()) {
        const pair = validatePair(symbolA, symbolB, symbolToIndex, `${source}s.${symbolA}.${symbolB}`, true);
        apply(pair, rowRecord[symbolB] as NumericInput, `${source}s.${symbolA}.${symbolB}`);
      }
    }
  }
  return map;
}

function covarianceFromRelationships(
  quantities: readonly ResolvedQuantity[],
  input: MeasurementModelInput,
  symbolToIndex: ReadonlyMap<string, number>,
  options: NormalizedCalculationEngineOptions,
  diagnostics: CalculationDiagnostic[]
): number[][] {
  const covariance = createZeroMatrix(quantities.length);
  for (let i = 0; i < quantities.length; i += 1) {
    covariance[i]![i] = quantities[i]!.standardUncertainty ** 2;
  }

  const correlations = collectRelationships(input.correlations, "correlation", symbolToIndex, options);
  const covariances = collectRelationships(input.covariances, "covariance", symbolToIndex, options);

  for (const entry of [...correlations.values(), ...covariances.values()]) {
    if (entry.i === entry.j) {
      if (entry.source === "correlation") {
        if (Math.abs(entry.value - 1) > options.covarianceMatrixTolerance) {
          throw makeError(ERROR_CODES.INVALID_CORRELATION, "Correlation matrix diagonal entries must be 1.", { symbol: entry.symbolA, value: entry.value });
        }
      } else {
        const expected = covariance[entry.i]![entry.i]!;
        if (Math.abs(entry.value - expected) > options.covarianceMatrixTolerance) {
          throw makeError(ERROR_CODES.INVALID_COVARIANCE_MATRIX, "Covariance matrix diagonal contradicts quantity uncertainty.", { symbol: entry.symbolA, expected, actual: entry.value });
        }
      }
    }
  }

  for (const [key, corr] of correlations) {
    if (corr.i === corr.j) continue;
    const expectedCovariance = corr.value * quantities[corr.i]!.standardUncertainty * quantities[corr.j]!.standardUncertainty;
    const cov = covariances.get(key);
    if (cov !== undefined) {
      if (Math.abs(cov.value - expectedCovariance) > options.covarianceMatrixTolerance) {
        throw makeError(ERROR_CODES.INVALID_COVARIANCE_MATRIX, "Correlation and covariance for the same pair are inconsistent.", {
          pair: [corr.symbolA, corr.symbolB],
          correlation: corr.value,
          covariance: cov.value,
          expectedCovariance
        });
      }
      continue;
    }
    covariance[corr.i]![corr.j] = expectedCovariance;
    covariance[corr.j]![corr.i] = expectedCovariance;
  }

  for (const cov of covariances.values()) {
    if (cov.i === cov.j) continue;
    covariance[cov.i]![cov.j] = cov.value;
    covariance[cov.j]![cov.i] = cov.value;
  }

  validateCovarianceMatrix(covariance, quantities, options.covarianceMatrixTolerance);
  if (correlations.size > 0 || covariances.size > 0) {
    diagnostics.push({
      code: "COVARIANCE_TERMS_INCLUDED",
      severity: "info",
      message: "Combined standard uncertainty includes validated covariance/correlation terms.",
      details: {
        correlations: correlations.size,
        covariances: covariances.size,
        covarianceMatrix: covariance.map((row) => row.map((value) => numberText(value, options)))
      }
    });
  }
  return covariance;
}

function validateCovarianceMatrix(matrix: readonly (readonly number[])[], quantities: readonly ResolvedQuantity[], tolerance: number): void {
  for (let i = 0; i < matrix.length; i += 1) {
    const row = matrix[i]!;
    if (row.length !== matrix.length) {
      throw makeError(ERROR_CODES.INVALID_COVARIANCE_MATRIX, "Covariance matrix must be square.", { row: i });
    }
    const variance = row[i] ?? Number.NaN;
    if (!Number.isFinite(variance) || variance < -tolerance) {
      throw makeError(ERROR_CODES.INVALID_COVARIANCE_MATRIX, "Covariance matrix variances must be non-negative and finite.", { row: i, variance });
    }
    for (let j = 0; j < matrix.length; j += 1) {
      const a = row[j] ?? Number.NaN;
      const b = matrix[j]?.[i] ?? Number.NaN;
      if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > tolerance) {
        throw makeError(ERROR_CODES.INVALID_COVARIANCE_MATRIX, "Covariance matrix must be symmetric and finite.", { i, j, a, b });
      }
      const bound = quantities[i]!.standardUncertainty * quantities[j]!.standardUncertainty;
      if (bound > 0 && Math.abs(a) - bound > Math.max(tolerance, bound * 1e-12)) {
        throw makeError(ERROR_CODES.INVALID_COVARIANCE_MATRIX, "Covariance magnitude exceeds the product of standard uncertainties.", { i, j, covariance: a, bound });
      }
    }
  }

  const size = matrix.length;
  const l = createZeroMatrix(size);
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = matrix[i]![j]!;
      for (let k = 0; k < j; k += 1) sum -= l[i]![k]! * l[j]![k]!;
      if (i === j) {
        if (sum < -tolerance) {
          throw makeError(ERROR_CODES.INVALID_COVARIANCE_MATRIX, "Covariance matrix is not positive semidefinite.", { pivot: i, value: sum });
        }
        l[i]![j] = sum <= 0 ? 0 : Math.sqrt(sum);
      } else if (l[j]![j]! > tolerance) {
        l[i]![j] = sum / l[j]![j]!;
      } else if (Math.abs(sum) > tolerance) {
        throw makeError(ERROR_CODES.INVALID_COVARIANCE_MATRIX, "Covariance matrix is not positive semidefinite near a singular pivot.", { i, j, residual: sum });
      } else {
        l[i]![j] = 0;
      }
    }
  }
}

function variablesInAst(ast: FormulaAstNode, variables = new Set<string>()): Set<string> {
  switch (ast.kind) {
    case "Variable":
      variables.add(ast.name);
      break;
    case "UnaryExpression":
      variablesInAst(ast.argument, variables);
      break;
    case "BinaryExpression":
      variablesInAst(ast.left, variables);
      variablesInAst(ast.right, variables);
      break;
    case "CallExpression":
      for (const arg of ast.args) variablesInAst(arg, variables);
      break;
    case "NumberLiteral":
      break;
  }
  return variables;
}

function nonSmoothFunctionsInAst(ast: FormulaAstNode, functions = new Set<SafeFunctionName>()): Set<SafeFunctionName> {
  if (ast.kind === "CallExpression") {
    if (NON_SMOOTH_FUNCTIONS.has(ast.functionName)) functions.add(ast.functionName);
    for (const arg of ast.args) nonSmoothFunctionsInAst(arg, functions);
  } else if (ast.kind === "UnaryExpression") nonSmoothFunctionsInAst(ast.argument, functions);
  else if (ast.kind === "BinaryExpression") {
    nonSmoothFunctionsInAst(ast.left, functions);
    nonSmoothFunctionsInAst(ast.right, functions);
  }
  return functions;
}

function getNumberScopeForAst(ast: FormulaAstNode, quantities: readonly ResolvedQuantity[], options: NormalizedCalculationEngineOptions): Record<string, number> {
  const required = variablesInAst(ast);
  const scope: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const quantity of quantities) {
    if (required.has(quantity.symbol)) {
      scope[quantity.symbol] = numericInputToNumber(quantity.estimateInput, `${quantity.symbol}.estimate`, options, true);
    }
  }
  return scope;
}

function assertGumFormulaSmoothness(input: MeasurementModelInput, formula: CompiledFormula, quantities: readonly ResolvedQuantity[]): void {
  const nonSmooth = [...nonSmoothFunctionsInAst(formula.ast)].sort();
  if (nonSmooth.length === 0) return;
  const formulaVariables = new Set(formula.variables);
  const missing = quantities.filter((q) => formulaVariables.has(q.symbol) && q.sensitivityCoefficient === undefined).map((q) => q.symbol);
  if (input.allowNonSmoothWithExplicitSensitivities === true && missing.length === 0) return;
  throw makeError(ERROR_CODES.NON_DIFFERENTIABLE_MODEL, "GUM uncertainty propagation requires a differentiable model unless explicit sensitivities are supplied and explicitly allowed.", {
    functions: nonSmooth,
    variablesMissingExplicitSensitivity: missing,
    suggestedRemediation: "Provide sensitivityCoefficient for all variables affected by non-smooth functions and set allowNonSmoothWithExplicitSensitivities: true, or replace the model with a differentiable approximation."
  });
}

function assertSmoothDomains(ast: FormulaAstNode, quantities: readonly ResolvedQuantity[], options: NormalizedCalculationEngineOptions): void {
  if (ast.kind === "CallExpression") {
    for (const arg of ast.args) assertSmoothDomains(arg, quantities, options);
    const arg = ast.args[0];
    if (arg === undefined) return;
    if (["sqrt", "log", "log10", "asin", "acos", "tan"].includes(ast.functionName)) {
      const backend = new NumberBackend(options.decimalPrecision, options.maxExponentMagnitude, options.maxNumericInputLength, options.maxSignificantDigits);
      const scope = getNumberScopeForAst(arg, quantities, options);
      const value = backend.toNumber(evaluateAst(arg, scope, backend));
      if (ast.functionName === "sqrt" && value < 0) throw makeError(ERROR_CODES.DOMAIN_ERROR, "sqrt domain requires x >= 0.", { value });
      if ((ast.functionName === "log" || ast.functionName === "log10") && value <= 0) throw makeError(ERROR_CODES.DOMAIN_ERROR, `${ast.functionName} domain requires x > 0.`, { value });
      if ((ast.functionName === "asin" || ast.functionName === "acos") && !(value >= -1 && value <= 1)) throw makeError(ERROR_CODES.DOMAIN_ERROR, `${ast.functionName} domain requires -1 <= x <= 1.`, { value });
      if (ast.functionName === "tan" && Math.abs(Math.cos(value)) < 1e-12) throw makeError(ERROR_CODES.DOMAIN_ERROR, "tan argument is too close to a pole for GUM linearization.", { value });
    }
    return;
  }
  if (ast.kind === "UnaryExpression") assertSmoothDomains(ast.argument, quantities, options);
  if (ast.kind === "BinaryExpression") {
    assertSmoothDomains(ast.left, quantities, options);
    assertSmoothDomains(ast.right, quantities, options);
  }
}

function resolveSensitivityCoefficients(formula: CompiledFormula, quantities: readonly ResolvedQuantity[], options: NormalizedCalculationEngineOptions, diagnostics: CalculationDiagnostic[]): readonly number[] {
  const numberBackend = new NumberBackend(options.decimalPrecision, options.maxExponentMagnitude, options.maxNumericInputLength, options.maxSignificantDigits);
  const formulaVariableSet = new Set(formula.variables);

  return quantities.map((quantity) => {
    if (quantity.sensitivityCoefficient !== undefined) {
      diagnostics.push({ code: "SENSITIVITY_USER_PROVIDED", severity: "info", message: `Sensitivity coefficient for ${quantity.symbol} was provided by the caller.`, details: { symbol: quantity.symbol } });
      return quantity.sensitivityCoefficient;
    }
    if (!formulaVariableSet.has(quantity.symbol)) {
      diagnostics.push({ code: "QUANTITY_NOT_IN_FORMULA", severity: "warning", message: `Quantity ${quantity.symbol} is not referenced by the formula and has zero sensitivity.`, details: { symbol: quantity.symbol } });
      return 0;
    }

    const derivativeAst = symbolicDerivative(formula.ast, quantity.symbol);
    if (derivativeAst !== null) {
      try {
        const scope = getNumberScopeForAst(derivativeAst, quantities, options);
        const value = numberBackend.toNumber(evaluateAst(derivativeAst, scope, numberBackend));
        if (Number.isFinite(value)) {
          diagnostics.push({ code: "SENSITIVITY_SYMBOLIC", severity: "info", message: `Sensitivity coefficient for ${quantity.symbol} was computed with symbolic differentiation.`, details: { symbol: quantity.symbol } });
          return value;
        }
      } catch {
        // Fall through to deterministic numerical differentiation and expose a diagnostic below.
      }
    }

    const estimates = getNumberScopeForAst(formula.ast, quantities, options);
    const numerical = numericalDerivative(formula.ast, quantity.symbol, estimates, {
      maxExponentMagnitude: options.maxExponentMagnitude,
      decimalPrecision: options.decimalPrecision,
      relativeStep: options.numericalDerivativeRelativeStep
    });
    const numericalHalfStep = numericalDerivative(formula.ast, quantity.symbol, estimates, {
      maxExponentMagnitude: options.maxExponentMagnitude,
      decimalPrecision: options.decimalPrecision,
      relativeStep: options.numericalDerivativeRelativeStep / 2
    });
    const relativeDifference = Math.abs(numerical - numericalHalfStep) / Math.max(1, Math.abs(numerical), Math.abs(numericalHalfStep));
    diagnostics.push({
      code: "SENSITIVITY_NUMERICAL_FALLBACK",
      severity: "warning",
      message: `Sensitivity coefficient for ${quantity.symbol} used deterministic numerical differentiation in double precision.`,
      details: { symbol: quantity.symbol, relativeStep: options.numericalDerivativeRelativeStep, precision: "IEEE-754 double", relativeDifference }
    });
    if (relativeDifference > 1e-4) {
      diagnostics.push({ code: "LINEARIZATION_NUMERICAL_INSTABILITY", severity: "warning", message: "Finite-difference sensitivity appears unstable; GUM first-order linearization may be unreliable.", details: { symbol: quantity.symbol, relativeDifference } });
    }
    return numerical;
  });
}

function estimateInputs(quantities: readonly ResolvedQuantity[]): Record<string, NumericInput> {
  const estimates: Record<string, NumericInput> = Object.create(null) as Record<string, NumericInput>;
  for (const quantity of quantities) estimates[quantity.symbol] = quantity.estimateInput;
  return estimates;
}

function coverageProbabilityFromInput(input: MeasurementModelInput): number {
  const coverageProbability = input.coverageProbability ?? 0.95;
  if (typeof coverageProbability !== "number" || !Number.isFinite(coverageProbability) || !(coverageProbability > 0 && coverageProbability < 1)) {
    throw makeError(ERROR_CODES.INVALID_PROBABILITY, "Coverage probability must be finite, greater than 0, and less than 1.", { path: "coverageProbability", coverageProbability: String(coverageProbability) });
  }
  return coverageProbability;
}

export function evaluateMeasurementModelInternal(input: MeasurementModelInput, options: NormalizedCalculationEngineOptions): MeasurementModelResult {
  const inputRecord = assertPlainRecord(input, "input", ERROR_CODES.INVALID_INPUT_SHAPE, "Measurement model input must be a plain object.");
  assertNoDangerousKeys(inputRecord, "input", ERROR_CODES.INVALID_INPUT_SHAPE);
  assertAllowedKeys(inputRecord, MEASUREMENT_MODEL_INPUT_KEYS, "input", ERROR_CODES.UNSUPPORTED_INPUT_FIELD);
  if (hasOwn(inputRecord, "allowNonSmoothWithExplicitSensitivities")) {
    assertBoolean(inputRecord.allowNonSmoothWithExplicitSensitivities, "allowNonSmoothWithExplicitSensitivities", ERROR_CODES.INVALID_INPUT_SHAPE);
  }
  const quantitiesRecord = assertPlainRecord(inputRecord.quantities, "quantities", ERROR_CODES.INVALID_INPUT_SHAPE, "Measurement model quantities must be a plain object.") as Record<string, unknown>;
  assertNoDangerousKeys(quantitiesRecord, "quantities", ERROR_CODES.INVALID_INPUT_SHAPE);
  assertSafeIdentifierRecord(quantitiesRecord, options.maxIdentifierLength);
  const symbols = Object.keys(quantitiesRecord).sort();
  if (symbols.length === 0) throw makeError(ERROR_CODES.INVALID_INPUT_SHAPE, "Measurement model requires at least one quantity.", { path: "quantities" });

  const typedInput = inputRecord as unknown as MeasurementModelInput;
  const quantities = symbols.map((symbol) => resolveQuantity(symbol, assertQuantityShape(quantitiesRecord[symbol], symbol), options));
  const compiledFormula = resolveCompiledFormula(inputRecord.formula, symbols, options);
  const diagnostics: CalculationDiagnostic[] = [{
    code: "MEASUREMENT_MODEL_AUDIT_CONTEXT",
    severity: "info",
    message: "Measurement model audit context captured.",
    details: { variables: compiledFormula.variables, normalizedFormula: compiledFormula.normalizedFormula, normalizedAst: compiledFormula.normalizedAst }
  }];

  assertGumFormulaSmoothness(typedInput, compiledFormula, quantities);
  assertSmoothDomains(compiledFormula.ast, quantities, options);
  const yEvaluation = compiledFormula.evaluate(estimateInputs(quantities), { rejectUnusedInputs: false });
  const sensitivities = resolveSensitivityCoefficients(compiledFormula, quantities, options, diagnostics);

  const symbolToIndex = new Map<string, number>(quantities.map((quantity, index) => [quantity.symbol, index]));
  const covariance = covarianceFromRelationships(quantities, typedInput, symbolToIndex, options, diagnostics);

  let combinedVariance = 0;
  for (let i = 0; i < quantities.length; i += 1) {
    for (let j = 0; j < quantities.length; j += 1) {
      combinedVariance += sensitivities[i]! * sensitivities[j]! * (covariance[i]?.[j] ?? 0);
    }
  }
  if (combinedVariance < 0 && Math.abs(combinedVariance) <= options.covarianceMatrixTolerance) combinedVariance = 0;
  if (!Number.isFinite(combinedVariance) || combinedVariance < 0) {
    throw makeError(ERROR_CODES.INVALID_COVARIANCE_MATRIX, "Combined variance is negative or non-finite; check covariance/correlation inputs.", { combinedVariance });
  }
  const combinedStandardUncertainty = Math.sqrt(combinedVariance);

  const rowContributionVariances = quantities.map((_, i) => {
    let row = 0;
    for (let j = 0; j < quantities.length; j += 1) row += sensitivities[j]! * (covariance[i]?.[j] ?? 0);
    return sensitivities[i]! * row;
  });
  const diagonalVarianceContributions = quantities.map((quantity, index) => ((sensitivities[index] ?? 0) ** 2) * (quantity.standardUncertainty ** 2));

  const effectiveDegreesOfFreedom = welchSatterthwaiteDegreesOfFreedom(combinedVariance, diagonalVarianceContributions, quantities.map((quantity) => quantity.degreesOfFreedom));
  if (typedInput.correlations !== undefined || typedInput.covariances !== undefined) {
    diagnostics.push({ code: "WELCH_SATTERTHWAITE_CORRELATION_LIMITATION", severity: "warning", message: "Effective degrees of freedom uses diagonal variance contributions; correlated models may require laboratory-specific validation.", details: { effectiveDegreesOfFreedom: Number.isFinite(effectiveDegreesOfFreedom) ? effectiveDegreesOfFreedom : "Infinity" } });
  }

  const coverageProbability = coverageProbabilityFromInput(typedInput);
  const coverageFactor = typedInput.coverageFactor === undefined ? coverageFactorForProbability(coverageProbability, effectiveDegreesOfFreedom) : numericInputToNumber(typedInput.coverageFactor, "coverageFactor", options);
  if (!Number.isFinite(coverageFactor) || !(coverageFactor > 0)) throw makeError(ERROR_CODES.INVALID_UNCERTAINTY, "Coverage factor must be positive and finite.", { coverageFactor });
  const expandedUncertainty = coverageFactor * combinedStandardUncertainty;

  const sensitivityCoefficients: Record<string, NumericOutput> = Object.create(null) as Record<string, NumericOutput>;
  for (let i = 0; i < quantities.length; i += 1) sensitivityCoefficients[quantities[i]!.symbol] = outputNumber(sensitivities[i]!, options);

  const uncertaintyBudget: UncertaintyBudgetEntry[] = quantities.map((quantity, index) => {
    const contributionVariance = rowContributionVariances[index] as number;
    const contributionPercent = combinedVariance === 0 ? 0 : 100 * contributionVariance / combinedVariance;
    return {
      symbol: quantity.symbol,
      estimate: quantity.estimateOutput,
      standardUncertainty: outputNumber(quantity.standardUncertainty, options),
      sensitivityCoefficient: outputNumber(sensitivities[index]!, options),
      contributionVariance: outputNumber(contributionVariance, options),
      contributionPercent: outputNumber(contributionPercent, options),
      degreesOfFreedom: outputDegreesOfFreedom(quantity.degreesOfFreedom, options),
      distribution: quantity.distribution,
      ...(quantity.unit === undefined ? {} : { unit: quantity.unit }),
      ...(quantity.metadata === undefined ? {} : { metadata: quantity.metadata })
    };
  });

  const canonicalCalculationInput: CanonicalJsonValue = {
    kind: "measurementModel",
    formulaFingerprint: compiledFormula.formulaFingerprint,
    quantities: quantities.map(quantityCanonical),
    correlations: normalizePairwiseInput(typedInput.correlations),
    covariances: normalizePairwiseInput(typedInput.covariances),
    options: {
      numericMode: options.numericMode,
      angleMode: options.angleMode,
      decimalPrecision: options.decimalPrecision,
      maxExponentMagnitude: options.maxExponentMagnitude,
      maxNumericInputLength: options.maxNumericInputLength,
      maxSignificantDigits: options.maxSignificantDigits,
      coverageProbability,
      coverageFactor,
      engineVersion: options.engineVersion
    }
  };

  const resultWithoutFingerprint: CanonicalJsonValue = {
    value: yEvaluation.valueText,
    combinedStandardUncertainty: numberText(combinedStandardUncertainty, options),
    expandedUncertainty: numberText(expandedUncertainty, options),
    coverageFactor: numberText(coverageFactor, options),
    coverageProbability,
    effectiveDegreesOfFreedom: Number.isFinite(effectiveDegreesOfFreedom) ? numberText(effectiveDegreesOfFreedom, options) : "Infinity",
    sensitivityCoefficients: outputRecordText(sensitivities, quantities, options),
    uncertaintyBudget: uncertaintyBudget.map((entry) => budgetEntryCanonical(entry)),
    diagnostics: diagnostics.map((diagnostic) => diagnosticCanonical(diagnostic)),
    formulaFingerprint: compiledFormula.formulaFingerprint,
    normalizedAst: compiledFormula.normalizedAst,
    normalizedFormula: compiledFormula.normalizedFormula
  };
  const calculationFingerprint = fingerprintText(canonicalJson({ input: canonicalCalculationInput, result: resultWithoutFingerprint }));
  const canonicalResultJson = canonicalJson({ ...resultWithoutFingerprint, calculationFingerprint });

  const result: MeasurementModelResult = {
    value: yEvaluation.value,
    combinedStandardUncertainty: outputNumber(combinedStandardUncertainty, options),
    expandedUncertainty: outputNumber(expandedUncertainty, options),
    coverageFactor: outputNumber(coverageFactor, options),
    coverageProbability,
    effectiveDegreesOfFreedom: outputDegreesOfFreedom(effectiveDegreesOfFreedom, options),
    sensitivityCoefficients: Object.freeze(sensitivityCoefficients),
    uncertaintyBudget: Object.freeze(uncertaintyBudget.map((entry) => freezeBudgetEntry(entry))),
    diagnostics: Object.freeze(diagnostics.map((diagnostic) => freezeDiagnostic(diagnostic))),
    formulaFingerprint: compiledFormula.formulaFingerprint,
    calculationFingerprint,
    canonicalResultJson,
    normalizedFormula: compiledFormula.normalizedFormula,
    normalizedAst: compiledFormula.normalizedAst
  };
  validateMeasurementResult(result);
  return Object.freeze(result);
}

function freezeBudgetEntry(entry: UncertaintyBudgetEntry): UncertaintyBudgetEntry {
  return Object.freeze({
    ...entry,
    ...(entry.metadata === undefined ? {} : { metadata: deepFreezeJsonLike(entry.metadata) })
  });
}

function freezeDiagnostic(diagnostic: CalculationDiagnostic): CalculationDiagnostic {
  return Object.freeze({
    ...diagnostic,
    ...(diagnostic.details === undefined ? {} : { details: deepFreezeJsonLike(diagnostic.details) as Record<string, unknown> })
  });
}

function validateMeasurementResult(result: MeasurementModelResult): void {
  const numbers: Array<[string, NumericOutput | "Infinity"]> = [
    ["value", result.value],
    ["combinedStandardUncertainty", result.combinedStandardUncertainty],
    ["expandedUncertainty", result.expandedUncertainty],
    ["coverageFactor", result.coverageFactor],
    ["effectiveDegreesOfFreedom", result.effectiveDegreesOfFreedom]
  ];
  for (const [path, value] of numbers) {
    if (value === "Infinity") continue;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) throw makeError(ERROR_CODES.NON_FINITE_RESULT, "Measurement result contains a non-finite numeric field.", { path, value: String(value) });
  }
  for (const [symbol, value] of Object.entries(result.sensitivityCoefficients)) {
    if (!Number.isFinite(Number(value))) throw makeError(ERROR_CODES.NON_FINITE_RESULT, "Measurement result contains a non-finite sensitivity coefficient.", { symbol, value: String(value) });
  }
  for (const entry of result.uncertaintyBudget) {
    for (const key of ["estimate", "standardUncertainty", "sensitivityCoefficient", "contributionVariance", "contributionPercent"] as const) {
      if (!Number.isFinite(Number(entry[key]))) throw makeError(ERROR_CODES.NON_FINITE_RESULT, "Measurement budget contains a non-finite numeric field.", { symbol: entry.symbol, field: key, value: String(entry[key]) });
    }
  }
}

function normalizePairwiseInput(input: MeasurementModelInput["correlations"] | MeasurementModelInput["covariances"]): CanonicalJsonValue | undefined {
  if (input === undefined) return undefined;
  const entries: CanonicalJsonValue[] = [];
  if (Array.isArray(input)) {
    for (const entry of input) {
      if (Array.isArray(entry)) entries.push({ symbols: [String(entry[0]), String(entry[1])].sort(), value: String(entry[2]) });
      else {
        const record = entry as Record<string, unknown>;
        const symbols = Array.isArray(record.symbols) ? record.symbols : ["", ""];
        const value = hasOwn(record, "coefficient") ? record.coefficient : hasOwn(record, "correlation") ? record.correlation : record.covariance;
        entries.push({ symbols: [String(symbols[0]), String(symbols[1])].sort(), value: String(value) });
      }
    }
  } else {
    const matrix = input as PairwiseMatrixInput;
    for (const symbolA of Object.keys(matrix).sort()) {
      const row = matrix[symbolA];
      if (row === undefined) continue;
      for (const symbolB of Object.keys(row).sort()) entries.push({ symbols: [symbolA, symbolB].sort(), value: String(row[symbolB]) });
    }
  }
  return entries.sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
}

function numberText(value: number, options: NormalizedCalculationEngineOptions): string {
  if (options.numericMode === "number") {
    const backend = new NumberBackend(options.decimalPrecision, options.maxExponentMagnitude, options.maxNumericInputLength, options.maxSignificantDigits);
    return backend.toCanonicalString(backend.fromNumber(value, "canonical result value"));
  }
  const backend = new DecimalBackend(options.decimalPrecision, options.maxExponentMagnitude, options.maxNumericInputLength, options.maxSignificantDigits);
  return backend.toCanonicalString(backend.fromNumber(value, "canonical result value"));
}

function outputRecordText(values: readonly number[], quantities: readonly ResolvedQuantity[], options: NormalizedCalculationEngineOptions): CanonicalJsonValue {
  const record: Record<string, CanonicalJsonValue> = {};
  for (let index = 0; index < quantities.length; index += 1) record[quantities[index]!.symbol] = numberText(values[index]!, options);
  return record;
}

function budgetEntryCanonical(entry: UncertaintyBudgetEntry): CanonicalJsonValue {
  return {
    symbol: entry.symbol,
    estimate: String(entry.estimate),
    standardUncertainty: String(entry.standardUncertainty),
    sensitivityCoefficient: String(entry.sensitivityCoefficient),
    contributionVariance: String(entry.contributionVariance),
    contributionPercent: String(entry.contributionPercent),
    degreesOfFreedom: String(entry.degreesOfFreedom),
    distribution: entry.distribution,
    unit: entry.unit,
    metadata: entry.metadata as CanonicalJsonValue | undefined
  };
}

function diagnosticCanonical(diagnostic: CalculationDiagnostic): CanonicalJsonValue {
  return { code: diagnostic.code, severity: diagnostic.severity, message: diagnostic.message, details: diagnostic.details as CanonicalJsonValue | undefined };
}
