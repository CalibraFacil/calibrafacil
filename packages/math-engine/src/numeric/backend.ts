import { ERROR_CODES } from "../errors/codes.js";
import { makeError } from "../errors/errors.js";
import { DeterministicDecimal } from "./decimal.js";
import type { NumericBackend, NumericInput, NumericMode } from "./types.js";
import { assertFiniteResult, safeNumberFromInput, validateNumericInput } from "./validation.js";

function canonicalNumber(value: number, precision = 16): string {
  const finite = assertFiniteResult(value, "number");
  if (Object.is(finite, -0)) return "0";
  const clampedPrecision = Math.max(1, Math.min(21, Math.trunc(precision)));
  let text = finite.toPrecision(clampedPrecision).toLowerCase();
  if (text.includes("e")) {
    let [coefficient = "0", exponent = "0"] = text.split("e");
    coefficient = canonicalNumber(Number(coefficient), clampedPrecision);
    exponent = Number(exponent).toString();
    return `${coefficient}e${exponent}`;
  }
  if (text.includes(".")) text = text.replace(/0+$/u, "").replace(/\.$/u, "");
  if (text === "-0") return "0";
  return text;
}

function assertUnaryDomain(result: number, fn: string, input: number): number {
  if (!Number.isFinite(result)) {
    const code = fn === "exp" ? ERROR_CODES.NON_FINITE_RESULT : ERROR_CODES.DOMAIN_ERROR;
    throw makeError(code, `Function ${fn} produced a non-finite result.`, { function: fn, input });
  }
  return assertFiniteResult(result, `${fn} result`);
}

export class NumberBackend implements NumericBackend<number> {
  readonly mode: NumericMode = "number";
  readonly decimalPrecision: number;
  readonly maxExponentMagnitude: number;
  readonly maxNumericInputLength: number;
  readonly maxSignificantDigits: number;

  constructor(decimalPrecision: number, maxExponentMagnitude: number, maxNumericInputLength = 512, maxSignificantDigits = 128) {
    this.decimalPrecision = decimalPrecision;
    this.maxExponentMagnitude = maxExponentMagnitude;
    this.maxNumericInputLength = maxNumericInputLength;
    this.maxSignificantDigits = maxSignificantDigits;
  }

  zero(): number { return 0; }
  one(): number { return 1; }
  fromInput(value: NumericInput, label = "value"): number {
    return safeNumberFromInput(value, {
      maxExponentMagnitude: this.maxExponentMagnitude,
      maxInputLength: this.maxNumericInputLength,
      maxSignificantDigits: this.maxSignificantDigits,
      label
    });
  }
  fromNumberLiteral(literal: string): number { return this.fromInput(literal, "number literal"); }
  fromNumber(value: number, label = "value"): number { return assertFiniteResult(value, label); }
  toNumber(value: number): number { return assertFiniteResult(value, "value"); }
  toOutput(value: number): number { return this.toNumber(value); }
  toCanonicalString(value: number): string { return canonicalNumber(value, this.decimalPrecision); }
  isZero(value: number): boolean { return value === 0; }
  abs(value: number): number { return Math.abs(value); }
  neg(value: number): number { return this.fromNumber(-value); }
  add(a: number, b: number): number { return this.fromNumber(a + b, "sum"); }
  sub(a: number, b: number): number { return this.fromNumber(a - b, "difference"); }
  mul(a: number, b: number): number { return this.fromNumber(a * b, "product"); }
  div(a: number, b: number): number {
    if (b === 0) throw makeError(ERROR_CODES.DIVISION_BY_ZERO, "Division by zero is not allowed.");
    return this.fromNumber(a / b, "quotient");
  }
  pow(a: number, b: number): number {
    if (Math.abs(b) > this.maxExponentMagnitude) {
      throw makeError(ERROR_CODES.EXPONENT_TOO_LARGE, "Exponent magnitude exceeds the configured limit.", { exponent: b });
    }
    return this.fromNumber(Math.pow(a, b), "power");
  }
  sqrt(a: number): number { return assertUnaryDomain(Math.sqrt(a), "sqrt", a); }
  sin(a: number): number { return assertUnaryDomain(Math.sin(a), "sin", a); }
  cos(a: number): number { return assertUnaryDomain(Math.cos(a), "cos", a); }
  tan(a: number): number { return assertUnaryDomain(Math.tan(a), "tan", a); }
  asin(a: number): number { return assertUnaryDomain(Math.asin(a), "asin", a); }
  acos(a: number): number { return assertUnaryDomain(Math.acos(a), "acos", a); }
  atan(a: number): number { return assertUnaryDomain(Math.atan(a), "atan", a); }
  log(a: number): number { return assertUnaryDomain(Math.log(a), "log", a); }
  log10(a: number): number { return assertUnaryDomain(Math.log10(a), "log10", a); }
  exp(a: number): number { return assertUnaryDomain(Math.exp(a), "exp", a); }
  min(values: readonly number[]): number {
    if (values.length === 0) throw makeError(ERROR_CODES.INVALID_FUNCTION_ARITY, "min requires at least one argument.");
    return this.fromNumber(Math.min(...values), "minimum");
  }
  max(values: readonly number[]): number {
    if (values.length === 0) throw makeError(ERROR_CODES.INVALID_FUNCTION_ARITY, "max requires at least one argument.");
    return this.fromNumber(Math.max(...values), "maximum");
  }
  floor(a: number): number { return this.fromNumber(Math.floor(a), "floor"); }
  ceil(a: number): number { return this.fromNumber(Math.ceil(a), "ceil"); }
  round(a: number): number { return this.fromNumber(Math.round(a), "round"); }
}

export class DecimalBackend implements NumericBackend<DeterministicDecimal> {
  readonly mode: NumericMode = "decimal";
  readonly decimalPrecision: number;
  readonly maxExponentMagnitude: number;
  readonly maxNumericInputLength: number;
  readonly maxSignificantDigits: number;

  constructor(decimalPrecision: number, maxExponentMagnitude: number, maxNumericInputLength = 512, maxSignificantDigits = 128) {
    this.decimalPrecision = decimalPrecision;
    this.maxExponentMagnitude = maxExponentMagnitude;
    this.maxNumericInputLength = maxNumericInputLength;
    this.maxSignificantDigits = maxSignificantDigits;
  }

  private parseOptions() {
    return {
      maxExponentMagnitude: this.maxExponentMagnitude,
      maxInputLength: this.maxNumericInputLength,
      maxSignificantDigits: this.maxSignificantDigits
    };
  }

  private internalParseOptions() {
    return {
      maxExponentMagnitude: this.maxExponentMagnitude,
      maxInputLength: Math.max(this.maxNumericInputLength, 64),
      maxSignificantDigits: Math.max(this.maxSignificantDigits, this.decimalPrecision, 21)
    };
  }

  zero(): DeterministicDecimal { return DeterministicDecimal.zero(); }
  one(): DeterministicDecimal { return DeterministicDecimal.one(); }
  fromInput(value: NumericInput, label = "value"): DeterministicDecimal {
    validateNumericInput(value, { ...this.parseOptions(), label });
    return DeterministicDecimal.from(value, label, this.parseOptions());
  }
  fromNumberLiteral(literal: string): DeterministicDecimal { return DeterministicDecimal.parse(literal, "number literal", this.parseOptions()); }
  fromNumber(value: number, label = "value"): DeterministicDecimal { return DeterministicDecimal.fromNumberFunction(value, label, this.internalParseOptions()); }
  toNumber(value: DeterministicDecimal): number { return value.toNumber(); }
  toOutput(value: DeterministicDecimal): string { return value.toCanonicalString(this.decimalPrecision); }
  toCanonicalString(value: DeterministicDecimal): string { return value.toCanonicalString(this.decimalPrecision); }
  isZero(value: DeterministicDecimal): boolean { return value.isZero(); }
  abs(value: DeterministicDecimal): DeterministicDecimal { return value.abs(); }
  neg(value: DeterministicDecimal): DeterministicDecimal { return value.neg(); }
  add(a: DeterministicDecimal, b: DeterministicDecimal): DeterministicDecimal { return a.add(b); }
  sub(a: DeterministicDecimal, b: DeterministicDecimal): DeterministicDecimal { return a.sub(b); }
  mul(a: DeterministicDecimal, b: DeterministicDecimal): DeterministicDecimal { return a.mul(b); }
  div(a: DeterministicDecimal, b: DeterministicDecimal): DeterministicDecimal { return a.div(b); }
  pow(a: DeterministicDecimal, b: DeterministicDecimal): DeterministicDecimal {
    const exponent = b.toNumber();
    if (Math.abs(exponent) > this.maxExponentMagnitude) {
      throw makeError(ERROR_CODES.EXPONENT_TOO_LARGE, "Exponent magnitude exceeds the configured limit.", { exponent });
    }
    if (b.isInteger() && absSafeBigInt(b.numerator) <= BigInt(this.maxExponentMagnitude)) {
      return a.powInteger(b.numerator);
    }
    return DeterministicDecimal.fromNumberFunction(Math.pow(a.toNumber(), exponent), "power", this.internalParseOptions());
  }
  sqrt(a: DeterministicDecimal): DeterministicDecimal { return unaryDecimal("sqrt", a, Math.sqrt, this.internalParseOptions()); }
  sin(a: DeterministicDecimal): DeterministicDecimal { return unaryDecimal("sin", a, Math.sin, this.internalParseOptions()); }
  cos(a: DeterministicDecimal): DeterministicDecimal { return unaryDecimal("cos", a, Math.cos, this.internalParseOptions()); }
  tan(a: DeterministicDecimal): DeterministicDecimal { return unaryDecimal("tan", a, Math.tan, this.internalParseOptions()); }
  asin(a: DeterministicDecimal): DeterministicDecimal { return unaryDecimal("asin", a, Math.asin, this.internalParseOptions()); }
  acos(a: DeterministicDecimal): DeterministicDecimal { return unaryDecimal("acos", a, Math.acos, this.internalParseOptions()); }
  atan(a: DeterministicDecimal): DeterministicDecimal { return unaryDecimal("atan", a, Math.atan, this.internalParseOptions()); }
  log(a: DeterministicDecimal): DeterministicDecimal { return unaryDecimal("log", a, Math.log, this.internalParseOptions()); }
  log10(a: DeterministicDecimal): DeterministicDecimal { return unaryDecimal("log10", a, Math.log10, this.internalParseOptions()); }
  exp(a: DeterministicDecimal): DeterministicDecimal { return unaryDecimal("exp", a, Math.exp, this.internalParseOptions()); }
  min(values: readonly DeterministicDecimal[]): DeterministicDecimal {
    if (values.length === 0) throw makeError(ERROR_CODES.INVALID_FUNCTION_ARITY, "min requires at least one argument.");
    return values.reduce((best, value) => value.compare(best) < 0 ? value : best);
  }
  max(values: readonly DeterministicDecimal[]): DeterministicDecimal {
    if (values.length === 0) throw makeError(ERROR_CODES.INVALID_FUNCTION_ARITY, "max requires at least one argument.");
    return values.reduce((best, value) => value.compare(best) > 0 ? value : best);
  }
  floor(a: DeterministicDecimal): DeterministicDecimal { return a.floor(); }
  ceil(a: DeterministicDecimal): DeterministicDecimal { return a.ceil(); }
  round(a: DeterministicDecimal): DeterministicDecimal { return a.round(); }
}

function absSafeBigInt(value: bigint): bigint { return value < 0n ? -value : value; }

function unaryDecimal(
  fn: string,
  input: DeterministicDecimal,
  operation: (value: number) => number,
  options: { readonly maxExponentMagnitude: number; readonly maxInputLength: number; readonly maxSignificantDigits: number }
): DeterministicDecimal {
  const numericInput = input.toNumber();
  const output = operation(numericInput);
  if (!Number.isFinite(output)) {
    const code = fn === "exp" ? ERROR_CODES.NON_FINITE_RESULT : ERROR_CODES.DOMAIN_ERROR;
    throw makeError(code, `Function ${fn} produced a non-finite result.`, {
      function: fn,
      input: input.toCanonicalString()
    });
  }
  return DeterministicDecimal.fromNumberFunction(output, `${fn} result`, options);
}

export function createNumericBackend(mode: NumericMode, decimalPrecision: number, maxExponentMagnitude: number, maxNumericInputLength = 512, maxSignificantDigits = 128): NumericBackend<number> | NumericBackend<DeterministicDecimal> {
  return mode === "number"
    ? new NumberBackend(decimalPrecision, maxExponentMagnitude, maxNumericInputLength, maxSignificantDigits)
    : new DecimalBackend(decimalPrecision, maxExponentMagnitude, maxNumericInputLength, maxSignificantDigits);
}

export { canonicalNumber };
