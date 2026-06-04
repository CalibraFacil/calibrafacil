import { ERROR_CODES } from "../errors/codes.js";
import { makeError } from "../errors/errors.js";
import { NumberBackend } from "../numeric/backend.js";
import type { NumericInput } from "../numeric/types.js";
import { assertPlainRecord, hasOwn, valueKind } from "../validation/shape.js";
import type { NumericValidationOptionSubset } from "./type-a.js";
import { normalizeNumericValidationOptions } from "./type-a.js";

export type TypeBDistribution = "normal" | "rectangular" | "uniform" | "triangular" | "u-shaped" | "arcsine" | "custom";

export interface TypeBStandardUncertaintyInput {
  readonly distribution: TypeBDistribution;
  readonly standardUncertainty?: NumericInput;
  readonly halfWidth?: NumericInput;
  readonly lowerLimit?: NumericInput;
  readonly upperLimit?: NumericInput;
  readonly expandedUncertainty?: NumericInput;
  readonly coverageFactor?: NumericInput;
  readonly divisor?: NumericInput;
}

export interface TypeBUncertaintyResult {
  readonly distribution: TypeBDistribution;
  readonly standardUncertainty: number;
  readonly divisor: number;
  readonly source: "standardUncertainty" | "halfWidth" | "limits" | "expandedUncertainty";
}

const SUPPORTED_TYPE_B_DISTRIBUTIONS: ReadonlySet<string> = new Set([
  "normal",
  "rectangular",
  "uniform",
  "triangular",
  "u-shaped",
  "arcsine",
  "custom"
]);

const ALLOWED_TYPE_B_FIELDS = new Set([
  "distribution",
  "standardUncertainty",
  "halfWidth",
  "lowerLimit",
  "upperLimit",
  "expandedUncertainty",
  "coverageFactor",
  "divisor"
]);

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw makeError(ERROR_CODES.INVALID_UNCERTAINTY, `${label} must be finite and non-negative.`, { path: label, value });
  }
  return value;
}

function finitePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || !(value > 0)) {
    throw makeError(ERROR_CODES.INVALID_UNCERTAINTY, `${label} must be finite and positive.`, { path: label, value });
  }
  return value;
}

function backendFromOptions(options: NumericValidationOptionSubset): NumberBackend {
  const safeOptions = normalizeNumericValidationOptions(options);
  return new NumberBackend(safeOptions.decimalPrecision, safeOptions.maxExponentMagnitude, safeOptions.maxNumericInputLength, safeOptions.maxSignificantDigits);
}

export function assertSupportedTypeBDistribution(value: unknown, path = "distribution"): TypeBDistribution {
  if (typeof value !== "string" || !SUPPORTED_TYPE_B_DISTRIBUTIONS.has(value)) {
    throw makeError(ERROR_CODES.INVALID_DISTRIBUTION, "Type B distribution is not supported by this package.", {
      path,
      value: typeof value === "string" ? value : valueKind(value),
      supportedDistributions: [...SUPPORTED_TYPE_B_DISTRIBUTIONS].sort()
    });
  }
  return value as TypeBDistribution;
}

function validateTypeBShape(input: unknown): Record<string, unknown> {
  const record = assertPlainRecord(input, "typeB", ERROR_CODES.INVALID_INPUT_SHAPE, "Type B uncertainty input must be a plain object.");
  for (const key of Object.keys(record)) {
    if (!ALLOWED_TYPE_B_FIELDS.has(key)) {
      throw makeError(ERROR_CODES.INVALID_TYPE_B_CONFIGURATION, "Type B uncertainty input contains an unsupported field.", { path: `typeB.${key}`, field: key });
    }
  }
  return record;
}

function failAmbiguous(message: string, details: Record<string, unknown>): never {
  throw makeError(ERROR_CODES.INVALID_TYPE_B_CONFIGURATION, message, {
    suggestedRemediation: "Provide exactly one documented Type B uncertainty source for the selected distribution.",
    ...details
  });
}

export function typeBStandardUncertainty(input: TypeBStandardUncertaintyInput, options: NumericValidationOptionSubset = {}): TypeBUncertaintyResult {
  const record = validateTypeBShape(input);
  const backend = backendFromOptions(options);
  const distribution = assertSupportedTypeBDistribution(record.distribution, "distribution");

  const hasStandard = hasOwn(record, "standardUncertainty");
  const hasHalfWidth = hasOwn(record, "halfWidth");
  const hasLower = hasOwn(record, "lowerLimit");
  const hasUpper = hasOwn(record, "upperLimit");
  const hasExpanded = hasOwn(record, "expandedUncertainty");
  const hasCoverage = hasOwn(record, "coverageFactor");
  const hasDivisor = hasOwn(record, "divisor");
  const hasLimits = hasLower || hasUpper;

  if (hasStandard) {
    if (hasHalfWidth || hasLimits || hasExpanded || hasCoverage || hasDivisor) {
      failAmbiguous("standardUncertainty must not be combined with other Type B source fields.", { distribution });
    }
    return Object.freeze({
      distribution,
      standardUncertainty: finiteNonNegative(backend.fromInput(record.standardUncertainty as NumericInput, "standardUncertainty"), "standardUncertainty"),
      divisor: 1,
      source: "standardUncertainty"
    });
  }

  if (distribution === "normal") {
    if (hasHalfWidth || hasLimits || hasDivisor) {
      failAmbiguous("Normal Type B uncertainty does not accept halfWidth, limits, or divisor without an explicit documented conversion.", { distribution });
    }
    if (!hasExpanded || !hasCoverage) {
      failAmbiguous("Normal Type B uncertainty requires either standardUncertainty or both expandedUncertainty and coverageFactor.", { distribution });
    }
    const expandedUncertainty = finiteNonNegative(backend.fromInput(record.expandedUncertainty as NumericInput, "expandedUncertainty"), "expandedUncertainty");
    const coverageFactor = finitePositive(backend.fromInput(record.coverageFactor as NumericInput, "coverageFactor"), "coverageFactor");
    return Object.freeze({ distribution, standardUncertainty: expandedUncertainty / coverageFactor, divisor: coverageFactor, source: "expandedUncertainty" });
  }

  if (hasExpanded || hasCoverage) {
    failAmbiguous("expandedUncertainty and coverageFactor are currently supported only for normal Type B configuration.", { distribution });
  }

  const halfWidth = resolveHalfWidth(record, backend);
  if (distribution === "custom") {
    if (!hasDivisor) {
      failAmbiguous("Custom Type B uncertainty requires standardUncertainty or an explicit divisor with halfWidth/limits.", { distribution });
    }
    const divisor = finitePositive(backend.fromInput(record.divisor as NumericInput, "divisor"), "divisor");
    return Object.freeze({ distribution, standardUncertainty: halfWidth / divisor, divisor, source: hasHalfWidth ? "halfWidth" : "limits" });
  }

  if (hasDivisor) {
    failAmbiguous("divisor is accepted only for custom Type B configuration.", { distribution });
  }
  const divisor = divisorForDistribution(distribution);
  return Object.freeze({ distribution, standardUncertainty: halfWidth / divisor, divisor, source: hasHalfWidth ? "halfWidth" : "limits" });
}

function resolveHalfWidth(record: Record<string, unknown>, backend: NumberBackend): number {
  const hasHalfWidth = hasOwn(record, "halfWidth");
  const hasLower = hasOwn(record, "lowerLimit");
  const hasUpper = hasOwn(record, "upperLimit");
  if (hasHalfWidth && (hasLower || hasUpper)) {
    failAmbiguous("halfWidth and limits must not be combined in one Type B configuration.", { hasHalfWidth, hasLower, hasUpper });
  }
  if (hasHalfWidth) return finiteNonNegative(backend.fromInput(record.halfWidth as NumericInput, "halfWidth"), "halfWidth");
  if (hasLower !== hasUpper) {
    failAmbiguous("lowerLimit and upperLimit must be provided together.", { hasLower, hasUpper });
  }
  if (hasLower && hasUpper) {
    const lower = backend.fromInput(record.lowerLimit as NumericInput, "lowerLimit");
    const upper = backend.fromInput(record.upperLimit as NumericInput, "upperLimit");
    if (!(upper >= lower)) throw makeError(ERROR_CODES.INVALID_UNCERTAINTY, "upperLimit must be greater than or equal to lowerLimit.", { lowerLimit: lower, upperLimit: upper });
    return (upper - lower) / 2;
  }
  failAmbiguous("Type B uncertainty requires standardUncertainty, halfWidth, limits, or an expanded-normal configuration.", { distribution: record.distribution });
}

function divisorForDistribution(distribution: TypeBDistribution): number {
  switch (distribution) {
    case "rectangular":
    case "uniform": return Math.sqrt(3);
    case "triangular": return Math.sqrt(6);
    case "u-shaped":
    case "arcsine": return Math.sqrt(2);
    case "normal":
    case "custom": return 1;
  }
}
