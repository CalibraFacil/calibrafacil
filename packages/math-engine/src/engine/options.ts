import { ERROR_CODES } from "../errors/codes.js";
import { makeError } from "../errors/errors.js";
import type { FormulaLimits } from "../parser/options.js";
import { mergeFormulaLimits } from "../parser/options.js";
import type { NumericMode } from "../numeric/types.js";
import { assertAllowedKeys, assertBoolean, assertNoDangerousKeys, assertPlainRecord, hasOwn } from "../validation/shape.js";

export const ENGINE_VERSION = "0.4.0";

/**
 * The canonical engine configuration for certificate-producing method
 * execution. Every runtime that evaluates a compiled method (cloud API
 * routes, the local desktop server, the web method preview) must build its
 * engine from this object: the numeric contract that defines certificate
 * values lives here and only here, so cloud and desktop cannot drift apart.
 */
export const METHOD_ENGINE_OPTIONS = Object.freeze({
  numericMode: "decimal",
  rejectUnusedInputs: true,
  maxExponentMagnitude: 12,
  maxSignificantDigits: 24,
}) satisfies CalculationEngineOptions;

export type AngleMode = "radian";

export interface CalculationEngineOptions extends Partial<FormulaLimits> {
  readonly numericMode?: NumericMode;
  readonly angleMode?: AngleMode;
  readonly decimalPrecision?: number;
  readonly maxNumericInputLength?: number;
  readonly maxSignificantDigits?: number;
  readonly rejectUnusedInputs?: boolean;
  readonly numericalDerivativeRelativeStep?: number;
  readonly covarianceMatrixTolerance?: number;
}

export interface NormalizedCalculationEngineOptions extends FormulaLimits {
  readonly numericMode: NumericMode;
  readonly angleMode: AngleMode;
  readonly decimalPrecision: number;
  readonly maxNumericInputLength: number;
  readonly maxSignificantDigits: number;
  readonly rejectUnusedInputs: boolean;
  readonly numericalDerivativeRelativeStep: number;
  readonly covarianceMatrixTolerance: number;
  readonly engineVersion: string;
}

const ENGINE_OPTION_KEYS = new Set([
  "numericMode",
  "angleMode",
  "decimalPrecision",
  "maxExpressionLength",
  "maxAstDepth",
  "maxAstNodes",
  "maxIdentifierLength",
  "maxNumberLiteralLength",
  "maxExponentMagnitude",
  "maxNumericInputLength",
  "maxSignificantDigits",
  "rejectUnusedInputs",
  "numericalDerivativeRelativeStep",
  "covarianceMatrixTolerance"
]);

function assertPositiveInteger(value: number, name: string, max: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw makeError(ERROR_CODES.INVALID_OPTIONS, `${name} must be an integer between 1 and ${max}.`, { [name]: value });
  }
}

export function normalizeEngineOptions(options: CalculationEngineOptions = {}): NormalizedCalculationEngineOptions {
  const optionsRecord = assertPlainRecord(options, "options", ERROR_CODES.INVALID_OPTIONS, "Calculation engine options must be a plain object.");
  assertNoDangerousKeys(optionsRecord, "options", ERROR_CODES.INVALID_OPTIONS);
  assertAllowedKeys(optionsRecord, ENGINE_OPTION_KEYS, "options", ERROR_CODES.INVALID_OPTIONS);
  const limits = mergeFormulaLimits(options);

  assertPositiveInteger(limits.maxExpressionLength, "maxExpressionLength", 100000);
  assertPositiveInteger(limits.maxAstDepth, "maxAstDepth", 10000);
  assertPositiveInteger(limits.maxAstNodes, "maxAstNodes", 100000);
  assertPositiveInteger(limits.maxIdentifierLength, "maxIdentifierLength", 1024);
  assertPositiveInteger(limits.maxNumberLiteralLength, "maxNumberLiteralLength", 10000);
  if (!Number.isSafeInteger(limits.maxExponentMagnitude) || limits.maxExponentMagnitude < 0 || limits.maxExponentMagnitude > 100000) {
    throw makeError(ERROR_CODES.INVALID_OPTIONS, "maxExponentMagnitude must be an integer between 0 and 100000.", {
      maxExponentMagnitude: limits.maxExponentMagnitude
    });
  }
  const numericMode = options.numericMode ?? "decimal";
  if (numericMode !== "decimal" && numericMode !== "number") {
    throw makeError(ERROR_CODES.INVALID_OPTIONS, "numericMode must be decimal or number.", { numericMode });
  }
  const angleMode = options.angleMode ?? "radian";
  if (angleMode !== "radian") {
    throw makeError(ERROR_CODES.INVALID_OPTIONS, "Only radian angle mode is currently supported.", { angleMode });
  }
  const decimalPrecision = options.decimalPrecision ?? 16;
  assertPositiveInteger(decimalPrecision, "decimalPrecision", 21);

  const maxNumericInputLength = options.maxNumericInputLength ?? limits.maxNumberLiteralLength;
  assertPositiveInteger(maxNumericInputLength, "maxNumericInputLength", 10000);

  const maxSignificantDigits = options.maxSignificantDigits ?? 128;
  assertPositiveInteger(maxSignificantDigits, "maxSignificantDigits", 10000);

  if (hasOwn(optionsRecord, "rejectUnusedInputs")) {
    assertBoolean(optionsRecord.rejectUnusedInputs, "rejectUnusedInputs", ERROR_CODES.INVALID_OPTIONS);
  }

  const numericalDerivativeRelativeStep = options.numericalDerivativeRelativeStep ?? 1e-6;
  if (!Number.isFinite(numericalDerivativeRelativeStep) || numericalDerivativeRelativeStep <= 0 || numericalDerivativeRelativeStep > 0.1) {
    throw makeError(ERROR_CODES.INVALID_OPTIONS, "numericalDerivativeRelativeStep must be positive, finite, and <= 0.1.", {
      numericalDerivativeRelativeStep
    });
  }

  const covarianceMatrixTolerance = options.covarianceMatrixTolerance ?? 1e-12;
  if (!Number.isFinite(covarianceMatrixTolerance) || covarianceMatrixTolerance < 0 || covarianceMatrixTolerance > 1e-3) {
    throw makeError(ERROR_CODES.INVALID_OPTIONS, "covarianceMatrixTolerance must be finite and between 0 and 1e-3.", {
      covarianceMatrixTolerance
    });
  }

  return Object.freeze({
    ...limits,
    numericMode,
    angleMode,
    decimalPrecision,
    maxNumericInputLength,
    maxSignificantDigits,
    rejectUnusedInputs: options.rejectUnusedInputs ?? false,
    numericalDerivativeRelativeStep,
    covarianceMatrixTolerance,
    engineVersion: ENGINE_VERSION
  });
}
