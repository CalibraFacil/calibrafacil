import { ERROR_CODES } from "../errors/codes.js";
import { makeError } from "../errors/errors.js";
import type { NumericInput } from "./types.js";

export interface NumericValidationLimits {
  readonly maxExponentMagnitude: number;
  readonly maxInputLength: number;
  readonly maxSignificantDigits: number;
  readonly label?: string;
  readonly allowPositiveInfinity?: boolean;
  readonly requireNumberSafeForDouble?: boolean;
}

export interface ValidatedNumericString {
  readonly raw: string;
  readonly canonicalCoefficient: string;
  readonly sign: "" | "-";
  readonly integerPart: string;
  readonly fractionPart: string;
  readonly exponent: number;
  readonly significantDigits: number;
}

const DECIMAL_PATTERN = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/u;
const MAX_NUMBER_ABS_FOR_DOUBLE_OPERATIONS = 1e100;

// Sign + significant digits + decimal exponent, independent of how the text was
// written ("0.10", "1e-1" and "0.1" all become "1e-1"). Comparing the identity of
// the input against that of Number(input).toString() detects estimates that a
// double cannot carry (e.g. "9007199254740993" rounds to ...992) — the old
// magnitude-only guard let those through and the derivative came out wrong (audit).
function decimalIdentity(text: string): string {
  const negative = text.startsWith("-");
  const unsigned = text.startsWith("-") || text.startsWith("+") ? text.slice(1) : text;
  const [coefficient = "0", exponentText = "0"] = unsigned.toLowerCase().split("e");
  const [integerPart = "", fractionPart = ""] = coefficient.split(".");
  let digits = `${integerPart}${fractionPart}`.replace(/^0+/u, "");
  if (digits.length === 0) return "0";
  let trailingZeros = 0;
  while (digits.endsWith("0")) {
    digits = digits.slice(0, -1);
    trailingZeros += 1;
  }
  const exponent = Number(exponentText) - fractionPart.length + trailingZeros;
  return `${negative ? "-" : ""}${digits}e${exponent}`;
}

/** True when the validated decimal text survives a Number() conversion unchanged. */
export function roundTripsThroughDouble(text: string): boolean {
  const numeric = Number(text);
  return Number.isFinite(numeric) && decimalIdentity(text) === decimalIdentity(numeric.toString());
}

function codeForNumericInput(raw: unknown, label: string, reason: string, extra: Record<string, unknown> = {}): never {
  throw makeError(ERROR_CODES.INVALID_NUMERIC_INPUT, `${label} must be a finite decimal numeric value.`, {
    path: label,
    value: typeof raw === "string" && raw.length > 200 ? `${raw.slice(0, 200)}…` : String(raw),
    reason,
    suggestedRemediation: "Use a finite decimal literal within the configured size, significant-digit, and exponent limits.",
    ...extra
  });
}

/**
 * The decimal text of a JavaScript number given as input, in plain positional
 * notation. `Number.prototype.toString` switches to exponent notation below
 * 1e-6 and from 1e21 on, and the exponent limit then refused 1.5e-13 while the
 * same value written "0.00000000000015" was accepted (review). The digits are
 * the shortest that round-trip; only the notation changes.
 */
export function numberInputText(value: number): string {
  const text = value.toString();
  const exponentIndex = text.indexOf("e");
  if (exponentIndex < 0) return text;
  const negative = text.startsWith("-");
  const coefficient = text.slice(negative ? 1 : 0, exponentIndex);
  const exponent = Number(text.slice(exponentIndex + 1));
  const [integerPart = "", fractionPart = ""] = coefficient.split(".");
  const digits = `${integerPart}${fractionPart}`;
  // Position of the decimal point, counted from the left of `digits`.
  const point = integerPart.length + exponent;
  let plain: string;
  if (point <= 0) plain = `0.${"0".repeat(-point)}${digits}`;
  else if (point >= digits.length) plain = `${digits}${"0".repeat(point - digits.length)}`;
  else plain = `${digits.slice(0, point)}.${digits.slice(point)}`;
  return negative ? `-${plain}` : plain;
}

export function assertFiniteNumberInput(value: number, limits: NumericValidationLimits): number {
  const label = limits.label ?? "value";
  if (!Number.isFinite(value)) {
    if (value === Number.POSITIVE_INFINITY && limits.allowPositiveInfinity === true) return value;
    codeForNumericInput(value, label, "non_finite");
  }
  if (Object.is(value, -0)) return 0;
  validateNumericString(numberInputText(value), { ...limits, label });
  return value;
}

export function validateNumericInput(value: NumericInput, limits: NumericValidationLimits): ValidatedNumericString {
  const label = limits.label ?? "value";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) assertFiniteNumberInput(value, { ...limits, label });
    return validateNumericString(numberInputText(value), { ...limits, label });
  }
  return validateNumericString(value, { ...limits, label });
}

export function validateNumericString(raw: string, limits: NumericValidationLimits): ValidatedNumericString {
  const label = limits.label ?? "value";
  if (typeof raw !== "string") codeForNumericInput(raw, label, "not_string_or_number");
  if (raw.length === 0) codeForNumericInput(raw, label, "empty_string");
  if (raw.length > limits.maxInputLength) {
    codeForNumericInput(raw, label, "input_too_long", { maxInputLength: limits.maxInputLength, actualLength: raw.length });
  }
  const text = raw.trim();
  if (text.length === 0) codeForNumericInput(raw, label, "blank_string");
  if (text.length !== raw.length) codeForNumericInput(raw, label, "surrounding_whitespace");
  if (text === "Infinity" && limits.allowPositiveInfinity === true) {
    return { raw: text, canonicalCoefficient: "Infinity", sign: "", integerPart: "Infinity", fractionPart: "", exponent: 0, significantDigits: 8 };
  }
  if (!DECIMAL_PATTERN.test(text)) codeForNumericInput(raw, label, "invalid_decimal_syntax");

  const sign: "" | "-" = text.startsWith("-") ? "-" : "";
  const unsigned = text.startsWith("-") || text.startsWith("+") ? text.slice(1) : text;
  const exponentIndex = Math.max(unsigned.indexOf("e"), unsigned.indexOf("E"));
  const coefficient = exponentIndex >= 0 ? unsigned.slice(0, exponentIndex) : unsigned;
  const exponentRaw = exponentIndex >= 0 ? unsigned.slice(exponentIndex + 1) : "0";

  if (exponentRaw.length > 8) {
    codeForNumericInput(raw, label, "exponent_too_long", { maxExponentMagnitude: limits.maxExponentMagnitude });
  }
  const exponent = Number(exponentRaw);
  if (!Number.isSafeInteger(exponent)) {
    codeForNumericInput(raw, label, "unsafe_exponent", { exponent: exponentRaw });
  }
  if (Math.abs(exponent) > limits.maxExponentMagnitude) {
    throw makeError(ERROR_CODES.EXPONENT_TOO_LARGE, `${label} exponent exceeds the configured limit.`, {
      path: label,
      exponent,
      maxExponentMagnitude: limits.maxExponentMagnitude,
      suggestedRemediation: "Reduce the exponent magnitude or increase maxExponentMagnitude after a validation review."
    });
  }

  const [integerRaw = "", fractionRaw = ""] = coefficient.split(".");
  const integerPart = integerRaw.length === 0 ? "0" : integerRaw;
  const fractionPart = fractionRaw;
  const significantDigitsText = `${integerPart}${fractionPart}`.replace(/^0+/u, "");
  const significantDigits = significantDigitsText.length === 0 ? 1 : significantDigitsText.length;
  if (significantDigits > limits.maxSignificantDigits) {
    codeForNumericInput(raw, label, "too_many_significant_digits", {
      significantDigits,
      maxSignificantDigits: limits.maxSignificantDigits
    });
  }

  if (limits.requireNumberSafeForDouble === true) {
    const numeric = Number(text);
    if (!Number.isFinite(numeric)) {
      throw makeError(ERROR_CODES.NUMERIC_OVERFLOW, `${label} cannot be represented as a finite JavaScript number.`, {
        path: label,
        value: text,
        suggestedRemediation: "Provide explicit sensitivity coefficients or use a smaller nominal value for double-precision operations."
      });
    }
    if (Math.abs(numeric) > MAX_NUMBER_ABS_FOR_DOUBLE_OPERATIONS) {
      throw makeError(ERROR_CODES.UNSAFE_NUMERIC_RANGE, `${label} is outside the safe range for deterministic double-precision differentiation.`, {
        path: label,
        value: text,
        maxAbs: MAX_NUMBER_ABS_FOR_DOUBLE_OPERATIONS,
        suggestedRemediation: "Provide explicit sensitivity coefficients for variables with very large nominal values."
      });
    }
    if (!roundTripsThroughDouble(text)) {
      throw makeError(ERROR_CODES.UNSAFE_NUMERIC_RANGE, `${label} loses decimal precision when converted to a JavaScript number.`, {
        path: label,
        value: text,
        roundedValue: numeric.toString(),
        suggestedRemediation: "Provide explicit sensitivity coefficients or use inputs that round-trip through double precision."
      });
    }
  }

  return { raw: text, canonicalCoefficient: coefficient, sign, integerPart, fractionPart, exponent, significantDigits };
}

export function assertFiniteResult(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw makeError(ERROR_CODES.NON_FINITE_RESULT, `${label} produced a non-finite result.`, { path: label, value: String(value) });
  }
  if (Object.is(value, -0)) return 0;
  return value;
}

export function safeNumberFromInput(value: NumericInput, limits: NumericValidationLimits): number {
  const label = limits.label ?? "value";
  const validation = validateNumericInput(value, limits);
  if (validation.raw === "Infinity" && limits.allowPositiveInfinity === true) return Number.POSITIVE_INFINITY;
  const numeric = Number(validation.raw);
  if (!Number.isFinite(numeric)) {
    throw makeError(ERROR_CODES.NUMERIC_OVERFLOW, `${label} cannot be represented as a finite JavaScript number.`, {
      path: label,
      value: validation.raw
    });
  }
  // A non-zero input that a double reads as 0 (1e-400 under a raised exponent
  // limit) is refused like one that overflows, not taken as 0 (review).
  if (numeric === 0 && /[1-9]/u.test(validation.raw.split(/e/iu)[0] ?? "")) {
    throw makeError(ERROR_CODES.UNSAFE_NUMERIC_RANGE, `${label} is too small to be represented as a JavaScript number.`, {
      path: label,
      value: validation.raw
    });
  }
  return Object.is(numeric, -0) ? 0 : numeric;
}
