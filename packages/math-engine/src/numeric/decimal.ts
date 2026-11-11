import { ERROR_CODES } from "../errors/codes.js";
import { makeError } from "../errors/errors.js";
import { assertFiniteResult, numberInputText, validateNumericString } from "./validation.js";

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

const DOUBLE_BITS = new DataView(new ArrayBuffer(8));

/**
 * The double nearest (q + ε)·2^(-shift), ties to even, where q has at least 55
 * bits and ε in [0, 1) is zero unless `inexact`. Two bits below the 53 kept are
 * therefore always in q, so `inexact` only ever breaks a tie. The double is
 * assembled from its sign, exponent and fraction: no floating-point operation
 * takes part, so the result does not depend on the runtime. Returns ±Infinity
 * above the double range and ±0 below half the smallest subnormal.
 */
function roundScaledToDouble(q: bigint, inexact: boolean, shift: number, negative: boolean): number {
  const qBits = bitLength(q);
  // Exponent of the leading bit; below -1022 the double is subnormal and keeps fewer bits.
  const leadingExponent = qBits - 1 - shift;
  let drop = qBits - 53;
  if (leadingExponent < -1022) drop += -1022 - leadingExponent;
  const dropBits = BigInt(drop);
  let mantissa = q >> dropBits;
  const remainder = q - (mantissa << dropBits);
  const half = 1n << (dropBits - 1n);
  if (remainder > half || (remainder === half && (inexact || (mantissa & 1n) === 1n))) {
    mantissa += 1n;
  }
  let exponent = drop - shift;
  if (mantissa === 1n << 53n) {
    mantissa = 1n << 52n;
    exponent += 1;
  }
  let biasedExponent = 0;
  if (mantissa >= 1n << 52n) {
    biasedExponent = exponent + 1075;
    if (biasedExponent >= 2047) return negative ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    mantissa -= 1n << 52n;
  }
  DOUBLE_BITS.setBigUint64(0, (negative ? 1n << 63n : 0n) | (BigInt(biasedExponent) << 52n) | mantissa);
  return DOUBLE_BITS.getFloat64(0);
}

// The double nearest an exact rational (ties to even), or a non-finite value
// when the rational is outside the double range. Callers that must not fail on
// an out-of-range value (canonical text) use this directly; `toNumber` wraps it
// with the finite-result assertion. Up to 0.4.0 this was
// Number(numerator) / Number(denominator), three roundings that left about one
// input in five with 18 or more significant digits a unit or two in the last
// place off (review).
function ratioToDouble(numerator: bigint, denominator: bigint): number {
  if (numerator === 0n) return 0;
  const negative = numerator < 0n !== denominator < 0n;
  const n = absBigInt(numerator);
  const d = absBigInt(denominator);
  // n/d is within a factor of two of 2^(bits(n) - bits(d)): this shift gives the
  // quotient 55 or 56 bits.
  const shift = 55 - (bitLength(n) - bitLength(d));
  const scaledNumerator = shift >= 0 ? n << BigInt(shift) : n;
  const scaledDenominator = shift >= 0 ? d : d << BigInt(-shift);
  const quotient = scaledNumerator / scaledDenominator;
  const inexact = scaledNumerator % scaledDenominator !== 0n;
  return roundScaledToDouble(quotient, inexact, shift, negative);
}

/** floor(√value) for value >= 0, by Newton's iteration from above. */
function integerSquareRoot(value: bigint): bigint {
  if (value < 2n) return value;
  let x = 1n << BigInt((bitLength(value) + 1) >> 1);
  for (;;) {
    const next = (x + value / x) >> 1n;
    if (next >= x) return x;
    x = next;
  }
}

// The double nearest √(numerator/denominator) for a positive rational (ties to
// even): floor(√(n·4^k/d)) = ⌊√⌊n·4^k/d⌋⌋ is taken on integers with k chosen to
// give the root 56 or 57 bits, and both remainders decide the rounding.
function sqrtRatioToDouble(numerator: bigint, denominator: bigint): number {
  const halfExponent = (bitLength(numerator) - bitLength(denominator)) >> 1;
  const shift = 56 - halfExponent;
  const scaledNumerator = shift >= 0 ? numerator << BigInt(2 * shift) : numerator;
  const scaledDenominator = shift >= 0 ? denominator : denominator << BigInt(-2 * shift);
  const radicand = scaledNumerator / scaledDenominator;
  const root = integerSquareRoot(radicand);
  const inexact = root * root !== radicand || scaledNumerator % scaledDenominator !== 0n;
  return roundScaledToDouble(root, inexact, shift, false);
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

// Canonical texts stop expanding a terminating rational past this many fractional
// places and round it to the requested precision instead (see toCanonicalString);
// the exact text (toExactString) has no such cutoff.
const CANONICAL_EXACT_SCALE_LIMIT = 120;

function finiteDecimalString(
  numerator: bigint,
  denominator: bigint,
  maxScale: number,
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
  if (scale > maxScale) return null;

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

function rationalToPrecisionString(
  numerator: bigint,
  denominator: bigint,
  precision: number,
): string {
  const negative = numerator < 0n;
  const n = absBigInt(numerator);
  const numeratorDigits = n.toString().length;
  const denominatorDigits = denominator.toString().length;
  let exponent = numeratorDigits - denominatorDigits;
  const belowCandidatePower =
    exponent >= 0
      ? n < denominator * pow10(exponent)
      : n * pow10(-exponent) < denominator;
  if (belowCandidatePower) exponent -= 1;

  const scale = precision - 1 - exponent;
  const scaledNumerator = scale >= 0 ? n * pow10(scale) : n;
  const scaledDenominator =
    scale >= 0 ? denominator : denominator * pow10(-scale);
  let rounded = scaledNumerator / scaledDenominator;
  const remainder = scaledNumerator % scaledDenominator;
  if (remainder * 2n >= scaledDenominator) rounded += 1n;

  const precisionPower = pow10(precision);
  if (rounded >= precisionPower) {
    rounded /= 10n;
    exponent += 1;
  }

  let digits = rounded.toString().padStart(precision, "0");
  while (digits.endsWith("0")) digits = digits.slice(0, -1);
  const sign = negative ? "-" : "";

  if (exponent >= -6 && exponent < precision) {
    const decimalPosition = exponent + 1;
    if (decimalPosition <= 0) {
      return `${sign}0.${"0".repeat(-decimalPosition)}${digits}`;
    }
    if (decimalPosition >= digits.length) {
      return `${sign}${digits}${"0".repeat(decimalPosition - digits.length)}`;
    }
    return `${sign}${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
  }

  const coefficient =
    digits.length === 1 ? digits : `${digits[0]}.${digits.slice(1)}`;
  return `${sign}${coefficient}e${exponent}`;
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
      return DeterministicDecimal.parse(numberInputText(value), label, options);
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
    return assertFiniteResult(
      ratioToDouble(this.numerator, this.denominator),
      "decimal value",
    );
  }

  /**
   * The double nearest the square root of a non-negative value (ties to even),
   * taken on the exact rational: the squared quantity never has to be
   * representable as a double (a variance of 5e-401 has a standard deviation of
   * 7.07e-201), and the root is not rounded twice.
   */
  sqrtToNumber(): number {
    if (this.numerator < 0n) {
      throw makeError(
        ERROR_CODES.INVALID_NUMERIC_INPUT,
        "Square root of a negative decimal value is not defined.",
        { numerator: this.numerator.toString(), denominator: this.denominator.toString() },
      );
    }
    if (this.numerator === 0n) return 0;
    return assertFiniteResult(
      sqrtRatioToDouble(this.numerator, this.denominator),
      "decimal square root",
    );
  }

  /**
   * Exact terminating decimal expansion of the value, however many fractional
   * places it takes (a parsed input always terminates: its denominator is a
   * power of ten). Non-terminating rationals — only reachable from arithmetic,
   * never from parsing — are reported as a structured error rather than
   * rounded, so the text is always a lossless record of the value.
   */
  toExactString(): string {
    if (this.numerator === 0n) return "0";
    const exact = finiteDecimalString(
      this.numerator,
      this.denominator,
      Number.POSITIVE_INFINITY,
    );
    if (exact === null) {
      throw makeError(
        ERROR_CODES.UNSAFE_NUMERIC_RANGE,
        "Value has no terminating decimal expansion and cannot be recorded exactly.",
        {
          numerator: this.numerator.toString(),
          denominator: this.denominator.toString(),
        },
      );
    }
    return canonicalizeNumberString(exact);
  }

  toCanonicalString(precision = 16): string {
    if (this.numerator === 0n) return "0";
    const exactFinite = finiteDecimalString(
      this.numerator,
      this.denominator,
      CANONICAL_EXACT_SCALE_LIMIT,
    );
    if (exactFinite !== null) return canonicalizeNumberString(exactFinite);
    const clampedPrecision = Math.max(1, Math.min(21, Math.trunc(precision)));
    // Round the rational itself (exact half-up at `precision` significant
    // digits). Up to 0.3.0 this went through the nearest double and
    // `toPrecision`, which rounds the *binary* value and so could differ in the
    // last digit (-2/3 → …666 instead of …667) and emitted "0" below the double
    // range; 0.4.0 makes the text a function of the rational alone.
    return rationalToPrecisionString(
      this.numerator,
      this.denominator,
      clampedPrecision,
    );
  }
}
