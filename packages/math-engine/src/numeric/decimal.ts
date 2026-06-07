import { ERROR_CODES } from "../errors/codes.js";
import { makeError } from "../errors/errors.js";
import { assertFiniteResult, validateNumericString } from "./validation.js";

export interface DecimalParseOptions {
  readonly maxExponentMagnitude?: number;
  readonly maxInputLength?: number;
  readonly maxSignificantDigits?: number;
}

const DEFAULT_DECIMAL_PARSE_OPTIONS: Required<DecimalParseOptions> = {
  maxExponentMagnitude: 12,
  maxInputLength: 512,
  maxSignificantDigits: 128
};

function normalizeOptions(options: DecimalParseOptions = {}): Required<DecimalParseOptions> {
  return {
    maxExponentMagnitude: options.maxExponentMagnitude ?? DEFAULT_DECIMAL_PARSE_OPTIONS.maxExponentMagnitude,
    maxInputLength: options.maxInputLength ?? DEFAULT_DECIMAL_PARSE_OPTIONS.maxInputLength,
    maxSignificantDigits: options.maxSignificantDigits ?? DEFAULT_DECIMAL_PARSE_OPTIONS.maxSignificantDigits
  };
}

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = absBigInt(a);
  let y = absBigInt(b);
  while (y !== 0n) {
    const r = x % y;
    x = y;
    y = r;
  }
  return x === 0n ? 1n : x;
}

function pow10(exponent: number): bigint {
  if (!Number.isSafeInteger(exponent) || exponent < 0) {
    throw makeError(ERROR_CODES.INVALID_NUMERIC_INPUT, "Invalid decimal exponent.", { exponent });
  }
  return 10n ** BigInt(exponent);
}

function powBigInt(base: bigint, exponent: bigint): bigint {
  if (exponent < 0n) {
    throw makeError(ERROR_CODES.INVALID_NUMERIC_INPUT, "Negative BigInt exponent is not supported.", { exponent: exponent.toString() });
  }
  let result = 1n;
  let b = base;
  let e = exponent;
  while (e > 0n) {
    if ((e & 1n) === 1n) result *= b;
    e >>= 1n;
    if (e > 0n) b *= b;
  }
  return result;
}

function canonicalizeNumberString(text: string): string {
  if (text.includes("e") || text.includes("E")) {
    const [coefficientRaw = "0", exponentRaw = "0"] = text.toLowerCase().split("e");
    const exponent = Number(exponentRaw);
    if (!Number.isFinite(exponent)) return text.toLowerCase();
    const coefficient = canonicalizeNumberString(coefficientRaw);
    return `${coefficient}e${exponent.toString()}`;
  }

  let sign = "";
  let body = text;
  if (body.startsWith("-")) {
    sign = "-";
    body = body.slice(1);
  } else if (body.startsWith("+")) {
    body = body.slice(1);
  }

  if (body.includes(".")) {
    let [integerPart = "", fractionalPart = ""] = body.split(".");
    integerPart = integerPart === "" ? "0" : integerPart.replace(/^0+(?=\d)/u, "");
    fractionalPart = fractionalPart.replace(/0+$/u, "");
    body = fractionalPart.length === 0 ? integerPart : `${integerPart}.${fractionalPart}`;
  } else {
    body = body.replace(/^0+(?=\d)/u, "");
  }

  if (body === "0" || body === "") return "0";
  return `${sign}${body}`;
}

function finiteDecimalString(numerator: bigint, denominator: bigint): string | null {
  let denominatorWork = denominator;
  let twos = 0;
  let fives = 0;
  while (denominatorWork % 2n === 0n) {
    denominatorWork /= 2n;
    twos += 1;
  }
  while (denominatorWork % 5n === 0n) {
    denominatorWork /= 5n;
    fives += 1;
  }
  if (denominatorWork !== 1n) return null;
  const scale = Math.max(twos, fives);
  if (scale > 120) return null;

  const sign = numerator < 0n ? "-" : "";
  const multiplier = (2n ** BigInt(scale - twos)) * (5n ** BigInt(scale - fives));
  let scaled = (absBigInt(numerator) * multiplier).toString();

  if (scale === 0) return `${sign}${scaled}`;
  if (scaled.length <= scale) {
    scaled = `${"0".repeat(scale - scaled.length + 1)}${scaled}`;
  }
  const splitAt = scaled.length - scale;
  const integerPart = scaled.slice(0, splitAt);
  const fractionalPart = scaled.slice(splitAt).replace(/0+$/u, "");
  return fractionalPart.length === 0 ? `${sign}${integerPart}` : `${sign}${integerPart}.${fractionalPart}`;
}

export class DeterministicDecimal {
  readonly numerator: bigint;
  readonly denominator: bigint;

  private constructor(numerator: bigint, denominator: bigint) {
    if (denominator === 0n) {
      throw makeError(ERROR_CODES.DIVISION_BY_ZERO, "Decimal denominator cannot be zero.");
    }
    const sign = denominator < 0n ? -1n : 1n;
    const n = numerator * sign;
    const d = denominator * sign;
    const divisor = gcd(n, d);
    this.numerator = n / divisor;
    this.denominator = d / divisor;
  }

  static of(numerator: bigint, denominator = 1n): DeterministicDecimal {
    return new DeterministicDecimal(numerator, denominator);
  }

  static zero(): DeterministicDecimal { return DeterministicDecimal.of(0n); }
  static one(): DeterministicDecimal { return DeterministicDecimal.of(1n); }

  static from(value: number | string, label = "value", options?: DecimalParseOptions): DeterministicDecimal {
    if (typeof value === "number") {
      assertFiniteResult(value, label);
      return DeterministicDecimal.parse(value.toString(), label, options);
    }
    return DeterministicDecimal.parse(value, label, options);
  }

  static fromNumberFunction(value: number, label = "calculated value", options?: DecimalParseOptions): DeterministicDecimal {
    assertFiniteResult(value, label);
    return DeterministicDecimal.parse(value.toString(), label, options);
  }

  static parse(raw: string, label = "value", options?: DecimalParseOptions): DeterministicDecimal {
    const limits = normalizeOptions(options);
    const validated = validateNumericString(raw, { ...limits, label });
    const text = validated.raw;
    const sign = text.startsWith("-") ? -1n : 1n;
    const unsigned = text.startsWith("-") || text.startsWith("+") ? text.slice(1) : text;
    const [baseRaw = "0", exponentRaw] = unsigned.toLowerCase().split("e");
    const exponent = exponentRaw === undefined ? 0 : Number(exponentRaw);
    const [integerRaw = "", fractionRaw = ""] = baseRaw.split(".");
    const integerPart = integerRaw.length === 0 ? "0" : integerRaw;
    const digits = `${integerPart}${fractionRaw}`.replace(/^0+/u, "") || "0";
    const fractionalScale = fractionRaw.length;
    const scale = fractionalScale - exponent;
    const unsignedNumerator = BigInt(digits);

    if (scale >= 0) {
      return DeterministicDecimal.of(sign * unsignedNumerator, pow10(scale));
    }
    return DeterministicDecimal.of(sign * unsignedNumerator * pow10(-scale), 1n);
  }

  isZero(): boolean { return this.numerator === 0n; }
  isInteger(): boolean { return this.denominator === 1n; }
  abs(): DeterministicDecimal { return DeterministicDecimal.of(absBigInt(this.numerator), this.denominator); }
  neg(): DeterministicDecimal { return DeterministicDecimal.of(-this.numerator, this.denominator); }

  add(other: DeterministicDecimal): DeterministicDecimal {
    return DeterministicDecimal.of(this.numerator * other.denominator + other.numerator * this.denominator, this.denominator * other.denominator);
  }
  sub(other: DeterministicDecimal): DeterministicDecimal {
    return DeterministicDecimal.of(this.numerator * other.denominator - other.numerator * this.denominator, this.denominator * other.denominator);
  }
  mul(other: DeterministicDecimal): DeterministicDecimal { return DeterministicDecimal.of(this.numerator * other.numerator, this.denominator * other.denominator); }
  div(other: DeterministicDecimal): DeterministicDecimal {
    if (other.isZero()) throw makeError(ERROR_CODES.DIVISION_BY_ZERO, "Division by zero is not allowed.");
    return DeterministicDecimal.of(this.numerator * other.denominator, this.denominator * other.numerator);
  }

  powInteger(exponent: bigint): DeterministicDecimal {
    if (exponent === 0n) return DeterministicDecimal.one();
    const positiveExponent = exponent < 0n ? -exponent : exponent;
    const n = powBigInt(this.numerator, positiveExponent);
    const d = powBigInt(this.denominator, positiveExponent);
    return exponent < 0n ? DeterministicDecimal.of(d, n) : DeterministicDecimal.of(n, d);
  }

  compare(other: DeterministicDecimal): number {
    const lhs = this.numerator * other.denominator;
    const rhs = other.numerator * this.denominator;
    return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
  }

  floor(): DeterministicDecimal {
    let q = this.numerator / this.denominator;
    if (this.numerator < 0n && this.numerator % this.denominator !== 0n) q -= 1n;
    return DeterministicDecimal.of(q);
  }

  ceil(): DeterministicDecimal {
    let q = this.numerator / this.denominator;
    if (this.numerator > 0n && this.numerator % this.denominator !== 0n) q += 1n;
    return DeterministicDecimal.of(q);
  }

  round(): DeterministicDecimal {
    const value = this.toNumber();
    return DeterministicDecimal.fromNumberFunction(Math.round(value), "rounded value");
  }

  toNumber(): number {
    const value = Number(this.numerator) / Number(this.denominator);
    return assertFiniteResult(value, "decimal value");
  }

  toCanonicalString(precision = 16): string {
    if (this.numerator === 0n) return "0";
    const exactFinite = finiteDecimalString(this.numerator, this.denominator);
    if (exactFinite !== null) return canonicalizeNumberString(exactFinite);
    const value = this.toNumber();
    const clampedPrecision = Math.max(1, Math.min(21, Math.trunc(precision)));
    return canonicalizeNumberString(value.toPrecision(clampedPrecision));
  }
}
