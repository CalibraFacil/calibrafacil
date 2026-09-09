import { ERROR_CODES } from "../errors/codes.js";
import { makeError } from "../errors/errors.js";
import { mean, sampleStandardDeviation, standardUncertaintyOfMean } from "../gum/statistics.js";
import { NumberBackend } from "../numeric/backend.js";
import { DeterministicDecimal } from "../numeric/decimal.js";
import type { NumericInput } from "../numeric/types.js";
import { roundTripsThroughDouble, validateNumericString } from "../numeric/validation.js";
import { assertAllowedKeys, assertDenseArray, assertNoDangerousKeys, assertPlainRecord, hasOwn, valueKind } from "../validation/shape.js";

export interface NumericValidationOptionSubset {
  readonly decimalPrecision?: number;
  readonly maxExponentMagnitude?: number;
  readonly maxNumericInputLength?: number;
  readonly maxSignificantDigits?: number;
}

export interface TypeAUncertaintyResult {
  /** Observations as doubles (rounded when an input carries more precision than a double). */
  readonly observations: readonly number[];
  /**
   * Exact decimal text of each observation as parsed (every fractional place
   * kept, no rounding) — the samples the statistics were computed from.
   */
  readonly canonicalObservations: readonly string[];
  readonly count: number;
  readonly mean: number;
  /**
   * Exact decimal text of the mean, present only when the observations carry
   * more precision than a double and the exact mean both terminates and fits
   * the configured input limits. Callers that derive a quantity estimate from
   * repeated observations must prefer it over `mean`, which is the (rounded)
   * double view.
   */
  readonly canonicalMean?: string;
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

/**
 * Exact decimal text of a value when it terminates and stays inside the
 * configured input limits, so it can be handed back as a numeric input; `undefined`
 * when either condition fails and the caller must fall back to the double view.
 */
function exactDecimalTextWithinLimits(value: DeterministicDecimal, options: NormalizedNumericValidationOptionSubset): string | undefined {
  let text: string;
  try {
    text = value.toExactString();
  } catch {
    return undefined;
  }
  try {
    validateNumericString(text, {
      maxExponentMagnitude: options.maxExponentMagnitude,
      maxInputLength: options.maxNumericInputLength,
      maxSignificantDigits: options.maxSignificantDigits,
      label: "observations.mean"
    });
  } catch {
    return undefined;
  }
  return text;
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
  const count = numericObservations.length;
  const parseOptions = {
    maxExponentMagnitude: safeOptions.maxExponentMagnitude,
    maxInputLength: safeOptions.maxNumericInputLength,
    maxSignificantDigits: safeOptions.maxSignificantDigits
  };
  const exactObservations = observations.map((value, index) => DeterministicDecimal.from(value, `observation[${index}]`, parseOptions));
  // toExactString, not toCanonicalString: the canonical text rounds through a
  // double past 120 fractional places and would collapse the very samples the
  // exact branch below distinguishes (review).
  const canonicalObservations = exactObservations.map((value) => value.toExactString());
  if (observations.every((value) => typeof value === "number" || roundTripsThroughDouble(value))) {
    // Established double path, kept byte-for-byte for every observation set the
    // 0.3.0 engine already handles so recorded results stay reproducible.
    return Object.freeze({
      observations: numericObservations,
      canonicalObservations,
      count,
      mean: mean(numericObservations),
      sampleStandardDeviation: sampleStandardDeviation(numericObservations),
      standardUncertainty: standardUncertaintyOfMean(numericObservations),
      degreesOfFreedom: count - 1
    });
  }
  // At least one observation carries more decimal precision than a double: the
  // double path would silently centre on rounded values and report a spurious
  // spread (or zero). Centre and square exactly, converting to doubles only at
  // the end (audit). `canonicalObservations` carries the exact samples so the
  // reported statistics can be reproduced; `observations` are their doubles.
  const exactMean = exactObservations.reduce((sum, value) => sum.add(value), DeterministicDecimal.zero()).div(DeterministicDecimal.of(BigInt(count)));
  const exactSumOfSquares = exactObservations.reduce((sum, value) => {
    const difference = value.sub(exactMean);
    return sum.add(difference.mul(difference));
  }, DeterministicDecimal.zero());
  // The exact mean is the estimate a decimal-mode model must be evaluated at:
  // narrowing it to a double here would throw away the precision this branch
  // just recovered (review).
  const canonicalMean = exactDecimalTextWithinLimits(exactMean, safeOptions);
  // sqrtToNumber, not toNumber-then-Math.sqrt: at very small configured scales
  // the variance narrows to zero while the standard deviation is an ordinary
  // double (review). It runs the plain arithmetic first, so the values this
  // branch already produced are unchanged.
  const exactSampleStandardDeviation = exactSumOfSquares.div(DeterministicDecimal.of(BigInt(count - 1))).sqrtToNumber();
  return Object.freeze({
    observations: numericObservations,
    canonicalObservations,
    count,
    mean: exactMean.toNumber(),
    ...(canonicalMean === undefined ? {} : { canonicalMean }),
    sampleStandardDeviation: exactSampleStandardDeviation,
    standardUncertainty: exactSampleStandardDeviation / Math.sqrt(count),
    degreesOfFreedom: count - 1
  });
}
