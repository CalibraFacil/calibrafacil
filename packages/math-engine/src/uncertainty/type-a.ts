import { ERROR_CODES } from "../errors/codes.js";
import { makeError } from "../errors/errors.js";
import { mean, sampleStandardDeviation, standardUncertaintyOfMean } from "../gum/statistics.js";
import { NumberBackend } from "../numeric/backend.js";
import type { NumericInput } from "../numeric/types.js";
import { assertAllowedKeys, assertDenseArray, assertNoDangerousKeys, assertPlainRecord, hasOwn, valueKind } from "../validation/shape.js";

export interface NumericValidationOptionSubset {
  readonly decimalPrecision?: number;
  readonly maxExponentMagnitude?: number;
  readonly maxNumericInputLength?: number;
  readonly maxSignificantDigits?: number;
}

export interface TypeAUncertaintyResult {
  readonly observations: readonly number[];
  readonly count: number;
  readonly mean: number;
  readonly sampleStandardDeviation: number;
  readonly standardUncertainty: number;
  readonly degreesOfFreedom: number;
}

const NUMERIC_VALIDATION_OPTION_KEYS = new Set([
  "decimalPrecision",
  "maxExponentMagnitude",
  "maxNumericInputLength",
  "maxSignificantDigits"
]);

export interface NormalizedNumericValidationOptionSubset {
  readonly decimalPrecision: number;
  readonly maxExponentMagnitude: number;
  readonly maxNumericInputLength: number;
  readonly maxSignificantDigits: number;
}

function assertPositiveIntegerOption(record: Record<string, unknown>, key: keyof NormalizedNumericValidationOptionSubset, max: number): void {
  if (!hasOwn(record, key)) return;
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > max) {
    throw makeError(ERROR_CODES.INVALID_OPTIONS, `${key} must be an integer between 1 and ${max}.`, {
      path: `options.${key}`,
      [key]: value
    });
  }
}

export function normalizeNumericValidationOptions(options: unknown = {}): NormalizedNumericValidationOptionSubset {
  const record = assertPlainRecord(options, "options", ERROR_CODES.INVALID_OPTIONS, "Numeric validation options must be a plain object.");
  assertNoDangerousKeys(record, "options", ERROR_CODES.INVALID_OPTIONS);
  assertAllowedKeys(record, NUMERIC_VALIDATION_OPTION_KEYS, "options", ERROR_CODES.INVALID_OPTIONS);

  assertPositiveIntegerOption(record, "decimalPrecision", 21);
  assertPositiveIntegerOption(record, "maxNumericInputLength", 10000);
  assertPositiveIntegerOption(record, "maxSignificantDigits", 10000);
  if (hasOwn(record, "maxExponentMagnitude")) {
    const value = record.maxExponentMagnitude;
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 100000) {
      throw makeError(ERROR_CODES.INVALID_OPTIONS, "maxExponentMagnitude must be an integer between 0 and 100000.", {
        path: "options.maxExponentMagnitude",
        maxExponentMagnitude: value
      });
    }
  }

  return Object.freeze({
    decimalPrecision: (record.decimalPrecision as number | undefined) ?? 16,
    maxExponentMagnitude: (record.maxExponentMagnitude as number | undefined) ?? 12,
    maxNumericInputLength: (record.maxNumericInputLength as number | undefined) ?? 512,
    maxSignificantDigits: (record.maxSignificantDigits as number | undefined) ?? 128
  });
}

export function typeAFromRepeatedObservations(observations: readonly NumericInput[], options: NumericValidationOptionSubset = {}): TypeAUncertaintyResult {
  if (!Array.isArray(observations)) {
    throw makeError(ERROR_CODES.INVALID_INPUT_SHAPE, "Type A observations must be an array.", { path: "observations", valueType: valueKind(observations) });
  }
  assertDenseArray(observations, "observations", ERROR_CODES.INVALID_INPUT_SHAPE);
  if (observations.length < 2) {
    throw makeError(ERROR_CODES.INVALID_UNCERTAINTY, "Type A uncertainty requires at least two observations.", { count: observations.length });
  }
  const safeOptions = normalizeNumericValidationOptions(options);
  const backend = new NumberBackend(safeOptions.decimalPrecision, safeOptions.maxExponentMagnitude, safeOptions.maxNumericInputLength, safeOptions.maxSignificantDigits);
  const numericObservations = observations.map((value, index) => backend.fromInput(value, `observation[${index}]`));
  return Object.freeze({
    observations: numericObservations,
    count: numericObservations.length,
    mean: mean(numericObservations),
    sampleStandardDeviation: sampleStandardDeviation(numericObservations),
    standardUncertainty: standardUncertaintyOfMean(numericObservations),
    degreesOfFreedom: numericObservations.length - 1
  });
}
