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
  maxSignificantDigits: 128,
};

function normalizeOptions(
  options: DecimalParseOptions = {},
): Required<DecimalParseOptions> {
  return {
    maxExponentMagnitude:
      options.maxExponentMagnitude ??
      DEFAULT_DECIMAL_PARSE_OPTIONS.maxExponentMagnitude,
    maxInputLength:
      options.maxInputLength ?? DEFAULT_DECIMAL_PARSE_OPTIONS.maxInputLength,
    maxSignificantDigits:
      options.maxSignificantDigits ??
      DEFAULT_DECIMAL_PARSE_OPTIONS.maxSignificantDigits,
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
    throw makeError(
      ERROR_CODES.INVALID_NUMERIC_INPUT,
      "Invalid decimal exponent.",
      { exponent },
    );
  }
  return 10n ** BigInt(exponent);
}

function powBigInt(base: bigint, exponent: bigint): bigint {
  if (exponent < 0n) {
    throw makeError(
      ERROR_CODES.INVALID_NUMERIC_INPUT,
      "Negative BigInt exponent is not supported.",
      { exponent: exponent.toString() },
    );
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

// Hard upper bound on the magnitude of an exact rational's numerator/denominator.
// Real calibration formulas stay far below this (128-significant-digit inputs are
// ~425 bits; deeply nested products rarely exceed a few thousand bits), but a
// crafted expression such as ((10^12)^12)^12 grows the operand size geometrically
// and would otherwise block the event loop / OOM the process (see audit C1). The
// guard is enforced on every constructed value, so chained growth is rejected at
// the first level that crosses the bound rather than after the explosion.
const MAX_DECIMAL_BIT_LENGTH = 1 << 14; // 16384 bits ≈ 4932 decimal digits
const MAX_DECIMAL_MAGNITUDE = 1n << BigInt(MAX_DECIMAL_BIT_LENGTH);

function bitLength(value: bigint): number {
  let v = value < 0n ? -value : value;
  let bits = 0;
  while (v > 0xffffffffn) {
    v >>= 32n;
    bits += 32;
  }
  while (v > 0n) {
    v >>= 1n;
    bits += 1;
  }
  return bits;
}

function assertWithinMagnitude(numerator: bigint, denominator: bigint): void {
  if (
    absBigInt(numerator) >= MAX_DECIMAL_MAGNITUDE ||
    denominator >= MAX_DECIMAL_MAGNITUDE
  ) {
    throw makeError(
      ERROR_CODES.RESULT_MAGNITUDE_EXCEEDED,
      "Decimal result magnitude exceeds the maximum supported precision.",
      {
        maxBitLength: MAX_DECIMAL_BIT_LENGTH,
        suggestedRemediation:
          "Reduce the magnitude or precision of the expression; chained exponentiation of large values is not supported in exact decimal mode.",
      },
    );
  }
}

// Convert an exact rational to the nearest double without the silent-zero failure
// of `Number(num) / Number(den)` when a component overflows the double range (see
// audit finding on toNumber): build a normalized scientific string instead so tiny
// (denormal-range) and very large finite values round-trip correctly.
function ratioToNumber(numerator: bigint, denominator: bigint): number {
  if (numerator === 0n) return 0;
  const negative = numerator < 0n !== denominator < 0n;
  let n = absBigInt(numerator);
  let d = absBigInt(denominator);
  const precisionDigits = 18;
  const scale = d.toString().length - n.toString().length + precisionDigits;
  if (scale >= 0) n *= 10n ** BigInt(scale);
  else d *= 10n ** BigInt(-scale);
  const quotient = n / d;
  const magnitude = Number(`${quotient.toString()}e${(-scale).toString()}`);
  return negative ? -magnitude : magnitude;
}

function canonicalizeNumberString(text: string): string {
  if (text.includes("e") || text.includes("E")) {
    const [coefficientRaw = "0", exponentRaw = "0"] = text
      .toLowerCase()
      .split("e");
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
    integerPart =
      integerPart === "" ? "0" : integerPart.replace(/^0+(?=\d)/u, "");
    fractionalPart = fractionalPart.replace(/0+$/u, "");
    body =
      fractionalPart.length === 0
        ? integerPart
        : `${integerPart}.${fractionalPart}`;
  } else {
    body = body.replace(/^0+(?=\d)/u, "");
  }

  if (body === "0" || body === "") return "0";
  return `${sign}${body}`;
}

function finiteDecimalString(
  numerator: bigint,
  denominator: bigint,
): string | null {
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
  const multiplier = 2n ** BigInt(scale - twos) * 5n ** BigInt(scale - fives);
  let scaled = (absBigInt(numerator) * multiplier).toString();

  if (scale === 0) return `${sign}${scaled}`;
  if (scaled.length <= scale) {
    scaled = `${"0".repeat(scale - scaled.length + 1)}${scaled}`;
  }
  const splitAt = scaled.length - scale;
  const integerPart = scaled.slice(0, splitAt);
  const fractionalPart = scaled.slice(splitAt).replace(/0+$/u, "");
  return fractionalPart.length === 0
    ? `${sign}${integerPart}`
    : `${sign}${integerPart}.${fractionalPart}`;
}

export class DeterministicDecimal {
  readonly numerator: bigint;
  readonly denominator: bigint;

  private constructor(numerator: bigint, denominator: bigint) {
    if (denominator === 0n) {
      throw makeError(
        ERROR_CODES.DIVISION_BY_ZERO,
        "Decimal denominator cannot be zero.",
      );
    }
    const sign = denominator < 0n ? -1n : 1n;
    const n = numerator * sign;
    const d = denominator * sign;
    const divisor = gcd(n, d);
    const reducedNumerator = n / divisor;
    const reducedDenominator = d / divisor;
    assertWithinMagnitude(reducedNumerator, reducedDenominator);
    this.numerator = reducedNumerator;
    this.denominator = reducedDenominator;
  }

  static of(numerator: bigint, denominator = 1n): DeterministicDecimal {
    return new DeterministicDecimal(numerator, denominator);
  }

  static zero(): DeterministicDecimal {
    return DeterministicDecimal.of(0n);
  }
  static one(): DeterministicDecimal {
    return DeterministicDecimal.of(1n);
  }

  static from(
    value: number | string,
    label = "value",
    options?: DecimalParseOptions,
  ): DeterministicDecimal {
    if (typeof value === "number") {
      assertFiniteResult(value, label);
      return DeterministicDecimal.parse(value.toString(), label, options);
    }
    return DeterministicDecimal.parse(value, label, options);
  }

  static fromNumberFunction(
    value: number,
    label = "calculated value",
    options?: DecimalParseOptions,
  ): DeterministicDecimal {
    assertFiniteResult(value, label);
    return DeterministicDecimal.parse(value.toString(), label, options);
  }

  static parse(
    raw: string,
    label = "value",
    options?: DecimalParseOptions,
  ): DeterministicDecimal {
    const limits = normalizeOptions(options);
    const validated = validateNumericString(raw, { ...limits, label });
    const text = validated.raw;
    const sign = text.startsWith("-") ? -1n : 1n;
    const unsigned =
      text.startsWith("-") || text.startsWith("+") ? text.slice(1) : text;
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
    return DeterministicDecimal.of(
      sign * unsignedNumerator * pow10(-scale),
      1n,
    );
  }

  isZero(): boolean {
    return this.numerator === 0n;
  }
  isInteger(): boolean {
    return this.denominator === 1n;
  }
  abs(): DeterministicDecimal {
    return DeterministicDecimal.of(absBigInt(this.numerator), this.denominator);
  }
  neg(): DeterministicDecimal {
    return DeterministicDecimal.of(-this.numerator, this.denominator);
  }

  add(other: DeterministicDecimal): DeterministicDecimal {
    return DeterministicDecimal.of(
      this.numerator * other.denominator + other.numerator * this.denominator,
      this.denominator * other.denominator,
    );
  }
  sub(other: DeterministicDecimal): DeterministicDecimal {
    return DeterministicDecimal.of(
      this.numerator * other.denominator - other.numerator * this.denominator,
      this.denominator * other.denominator,
    );
  }
  mul(other: DeterministicDecimal): DeterministicDecimal {
    return DeterministicDecimal.of(
      this.numerator * other.numerator,
      this.denominator * other.denominator,
    );
  }
  div(other: DeterministicDecimal): DeterministicDecimal {
    if (other.isZero())
      throw makeError(
        ERROR_CODES.DIVISION_BY_ZERO,
        "Division by zero is not allowed.",
      );
    return DeterministicDecimal.of(
      this.numerator * other.denominator,
      this.denominator * other.numerator,
    );
  }

  powInteger(exponent: bigint): DeterministicDecimal {
    if (exponent === 0n) return DeterministicDecimal.one();
    const positiveExponent = exponent < 0n ? -exponent : exponent;
    // Reject before doing the expensive bignum multiply: the result occupies
    // roughly bitLength(base) * exponent bits. This keeps a crafted high-exponent
    // power from materializing a multi-megabit integer (audit C1).
    const baseBits = Math.max(
      bitLength(this.numerator),
      bitLength(this.denominator),
    );
    if (baseBits * Number(positiveExponent) > MAX_DECIMAL_BIT_LENGTH) {
      throw makeError(
        ERROR_CODES.RESULT_MAGNITUDE_EXCEEDED,
        "Decimal power result magnitude exceeds the maximum supported precision.",
        {
          maxBitLength: MAX_DECIMAL_BIT_LENGTH,
          suggestedRemediation:
            "Reduce the base magnitude or exponent; chained exponentiation of large values is not supported in exact decimal mode.",
        },
      );
    }
    const n = powBigInt(this.numerator, positiveExponent);
    const d = powBigInt(this.denominator, positiveExponent);
    return exponent < 0n
      ? DeterministicDecimal.of(d, n)
      : DeterministicDecimal.of(n, d);
  }

  compare(other: DeterministicDecimal): number {
    const lhs = this.numerator * other.denominator;
    const rhs = other.numerator * this.denominator;
    return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
  }

  floor(): DeterministicDecimal {
    let q = this.numerator / this.denominator;
    if (this.numerator < 0n && this.numerator % this.denominator !== 0n)
      q -= 1n;
    return DeterministicDecimal.of(q);
  }

  ceil(): DeterministicDecimal {
    let q = this.numerator / this.denominator;
    if (this.numerator > 0n && this.numerator % this.denominator !== 0n)
      q += 1n;
    return DeterministicDecimal.of(q);
  }

  round(): DeterministicDecimal {
    // Exact round-half-up (toward +∞), matching Math.round semantics without the
    // float64 double-rounding bug, e.g. round(2.4999999999999999) === 2, not 3.
    return this.add(DeterministicDecimal.of(1n, 2n)).floor();
  }

  toNumber(): number {
    const direct = Number(this.numerator) / Number(this.denominator);
    if (Number.isFinite(direct) && (direct !== 0 || this.numerator === 0n)) {
      return assertFiniteResult(direct, "decimal value");
    }
    // A component overflowed the double range, or the quotient underflowed to 0
    // while the value is non-zero; fall back to an exact normalized conversion.
    return assertFiniteResult(
      ratioToNumber(this.numerator, this.denominator),
      "decimal value",
    );
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
