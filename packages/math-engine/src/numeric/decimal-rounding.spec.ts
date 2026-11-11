/**
 * Narrowing an exact value to a double: `toNumber` and `sqrtToNumber` return the
 * nearest double, ties to even (0.5.0). Up to 0.4.0 `toNumber` divided two
 * rounded doubles and was one or two units in the last place off for about one
 * input in five with 18 or more significant digits; `sqrtToNumber` rounded
 * twice.
 *
 * The references are independent of the engine: `Number(text)`, which ECMAScript
 * defines as the correctly rounded value of a decimal literal, and an exact
 * comparison on integer fractions of the candidate with its two neighbours.
 */

import { describe, expect, it } from "vitest";
import { DecimalBackend } from "./backend.js";
import { DeterministicDecimal } from "./decimal.js";

const WIDE = { maxExponentMagnitude: 400, maxInputLength: 512, maxSignificantDigits: 128 } as const;

// The exhaustive cases work on integers of a few thousand bits: seconds on a slow runner.
const HEAVY = 60_000;

function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function randomDigits(random: () => number, count: number): string {
  let digits = String(1 + Math.floor(random() * 9));
  for (let i = 1; i < count; i += 1) digits += String(Math.floor(random() * 10));
  return digits;
}

function randomBigInt(random: () => number, bits: number): bigint {
  let value = 1n;
  for (let i = 1; i < bits; i += 1) value = (value << 1n) | (random() < 0.5 ? 0n : 1n);
  return value;
}

const bitsView = new DataView(new ArrayBuffer(8));

/** A finite double as an exact fraction [numerator, denominator]. */
function fractionOf(value: number): readonly [bigint, bigint] {
  bitsView.setFloat64(0, value);
  const bits = bitsView.getBigUint64(0);
  const negative = bits >> 63n === 1n;
  const biased = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  const mantissa = biased === 0 ? fraction : fraction | (1n << 52n);
  const exponent = (biased === 0 ? 1 : biased) - 1075;
  const signed = negative ? -mantissa : mantissa;
  return exponent >= 0 ? [signed << BigInt(exponent), 1n] : [signed, 1n << BigInt(-exponent)];
}

function neighbour(value: number, direction: 1 | -1): number {
  bitsView.setFloat64(0, value);
  const bits = bitsView.getBigUint64(0);
  // Positive doubles only: the next one up or down is the next bit pattern.
  bitsView.setBigUint64(0, direction === 1 ? bits + 1n : bits - 1n);
  return bitsView.getFloat64(0);
}

function isEven(value: number): boolean {
  bitsView.setFloat64(0, value);
  return (bitsView.getBigUint64(0) & 1n) === 0n;
}

/** sign of a/b - c/d for positive denominators. */
function compareFractions(a: bigint, b: bigint, c: bigint, d: bigint): number {
  const left = a * d;
  const right = c * b;
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Whether `candidate` (> 0, finite) is the double nearest to a positive exact
 * quantity, given how that quantity compares with a fraction: `compareWith(n, d)`
 * is the sign of (quantity - n/d). The quantity must not be beyond the midpoint
 * to either neighbour, and on a midpoint the candidate must be the even one.
 */
function isNearest(candidate: number, compareWith: (n: bigint, d: bigint) => number): boolean {
  const [cn, cd] = fractionOf(candidate);
  for (const direction of [1, -1] as const) {
    const other = neighbour(candidate, direction);
    if (!Number.isFinite(other)) continue;
    const [on, od] = fractionOf(other);
    // Midpoint (c + o)/2.
    const midN = cn * od + on * cd;
    const midD = 2n * cd * od;
    const side = compareWith(midN, midD) * direction;
    if (side > 0) return false;
    if (side === 0 && !isEven(candidate)) return false;
  }
  return true;
}

describe("DeterministicDecimal.toNumber is the nearest double", () => {
  it("agrees with Number(text) on 20 000 decimal literals of 1 to 40 digits, subnormals included", { timeout: HEAVY }, () => {
    const random = generator(20261111);
    const mismatches: string[] = [];
    for (let i = 0; i < 20000; i += 1) {
      const digits = randomDigits(random, 1 + Math.floor(random() * 40));
      const exponent = Math.floor(random() * 660) - 345;
      const text = `${random() < 0.5 ? "-" : ""}${digits}e${exponent}`;
      const expected = Number(text);
      if (!Number.isFinite(expected)) continue;
      const received = DeterministicDecimal.from(text, "probe", WIDE).toNumber();
      if (!Object.is(received, expected) && !(received === 0 && expected === 0)) mismatches.push(text);
    }
    expect(mismatches).toEqual([]);
  });

  it("agrees with Number(text) on the values 0.4.0 got wrong", () => {
    for (const text of ["80427220030586.574426022", "0.1234567890123456789012", "9007199254740993", "123456789012345678901234"]) {
      expect(DeterministicDecimal.from(text, "probe", WIDE).toNumber()).toBe(Number(text));
    }
  });

  it("is the nearest double for 5 000 rationals with numerators and denominators of up to 400 bits", { timeout: HEAVY }, () => {
    const random = generator(424242);
    const wrong: string[] = [];
    for (let i = 0; i < 5000; i += 1) {
      const n = randomBigInt(random, 1 + Math.floor(random() * 400));
      const d = randomBigInt(random, 1 + Math.floor(random() * 400));
      const value = DeterministicDecimal.of(n, d);
      const received = value.toNumber();
      const ok = isNearest(received, (mn, md) => compareFractions(value.numerator, value.denominator, mn, md));
      if (!ok) wrong.push(`${n}/${d}`);
    }
    expect(wrong).toEqual([]);
  });

  it("rounds a tie to the even neighbour", () => {
    // 2^53 + 1 lies exactly between 2^53 and 2^53 + 2.
    expect(DeterministicDecimal.of(2n ** 53n + 1n).toNumber()).toBe(2 ** 53);
    expect(DeterministicDecimal.of(2n ** 53n + 3n).toNumber()).toBe(2 ** 53 + 4);
    // Half the smallest subnormal rounds to 0, anything above it to the subnormal.
    expect(DeterministicDecimal.of(1n, 2n ** 1075n).toNumber()).toBe(0);
    expect(DeterministicDecimal.of(3n, 2n ** 1076n).toNumber()).toBe(Number.MIN_VALUE);
    expect(DeterministicDecimal.of(1n, 2n ** 1074n).toNumber()).toBe(Number.MIN_VALUE);
  });

  it("keeps exact doubles exact, to both ends of the range", () => {
    for (const value of [1, 0.5, 0.1, 1 / 3, 123456.789, Number.MAX_VALUE, Number.MIN_VALUE, 2.2250738585072014e-308, 2 ** -1060]) {
      const [n, d] = fractionOf(value);
      expect(DeterministicDecimal.of(n, d).toNumber()).toBe(value);
      expect(DeterministicDecimal.of(-n, d).toNumber()).toBe(-value);
    }
  });

  it("still refuses a value beyond the double range", () => {
    expect(() => DeterministicDecimal.from("1e400", "probe", WIDE).toNumber()).toThrow();
  });
});

describe("DeterministicDecimal.sqrtToNumber is the nearest double to the root", () => {
  it("holds for 2 000 rationals across the whole double range", { timeout: HEAVY }, () => {
    const random = generator(777);
    const wrong: string[] = [];
    for (let i = 0; i < 2000; i += 1) {
      const n = randomBigInt(random, 1 + Math.floor(random() * 900));
      const d = randomBigInt(random, 1 + Math.floor(random() * 900));
      const value = DeterministicDecimal.of(n, d);
      const received = value.sqrtToNumber();
      // √v against a midpoint m: compare v with m².
      const ok = isNearest(received, (mn, md) => compareFractions(value.numerator, value.denominator, mn * mn, md * md));
      if (!ok) wrong.push(`${n}/${d}`);
    }
    expect(wrong).toEqual([]);
  });

  it("is exact on perfect squares and on a root whose square underflows", () => {
    expect(DeterministicDecimal.of(49n, 4n).sqrtToNumber()).toBe(3.5);
    expect(DeterministicDecimal.from("1e-12", "probe", WIDE).sqrtToNumber()).toBe(1e-6);
    expect(DeterministicDecimal.of(2n).sqrtToNumber()).toBe(Math.SQRT2);
    const tiny = DeterministicDecimal.of(5n, 10n ** 401n);
    const root = tiny.sqrtToNumber();
    expect(isNearest(root, (mn, md) => compareFractions(tiny.numerator, tiny.denominator, mn * mn, md * md))).toBe(true);
    expect(Math.abs(root - 7.071067811865475e-201) / 7.071067811865475e-201).toBeLessThan(1e-15);
  });

  it("the decimal backend's sqrt does not turn a value below the double range into 0 (0.4.0)", () => {
    const backend = new DecimalBackend(16, 12);
    let value = backend.fromInput("5e-5", "probe");
    const step = backend.fromInput("1e-12", "probe");
    for (let i = 0; i < 33; i += 1) value = backend.mul(value, step);
    const root = backend.toNumber(backend.sqrt(value));
    expect(Math.abs(root - 7.071067811865475e-201) / 7.071067811865475e-201).toBeLessThan(1e-15);
  });
});
