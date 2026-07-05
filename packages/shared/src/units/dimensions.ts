/**
 * Dimensional-analysis core (DOM-10, slice 1).
 *
 * A pure, dependency-free layer that sits ALONGSIDE the unit registry
 * ({@link ./registry}) and gives every unit a SI *dimension vector*. It is the
 * foundation of the method-level dimensional lint decided in issue #663: it does
 * not touch the validated math engine and does no formula/AST checking (that is
 * slice 2). Everything here is exact over the rationals — there is deliberately
 * no floating-point exponent, because `sqrt` of a variance has dimension^(1/2).
 *
 * Scope note: affine offsets (°C vs K) are a CONVERSION concern handled by
 * {@link ./convert}. Dimensionally °C, °F and K are all Θ; the offset never
 * changes the dimension, so it is intentionally absent here.
 */

import { type QuantityKind, unitKind } from "./registry";

// ---------------------------------------------------------------------------
// Rational numbers (hand-rolled — a rational library would be overkill).
// Invariant: always reduced, denominator strictly positive, `n === 0 → d === 1`.
// ---------------------------------------------------------------------------

export interface Rational {
  readonly n: number;
  readonly d: number;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x === 0 ? 1 : x;
}

/**
 * Build a reduced {@link Rational}. Throws on non-integer components or a zero
 * denominator — dimension exponents must stay exact.
 */
export function rational(n: number, d = 1): Rational {
  if (!Number.isInteger(n) || !Number.isInteger(d)) {
    throw new RangeError(`rational() needs integers, got ${n}/${d}`);
  }
  if (d === 0) {
    throw new RangeError("rational() denominator cannot be zero");
  }
  if (n === 0) {
    return { n: 0, d: 1 };
  }
  let num = n;
  let den = d;
  if (den < 0) {
    num = -num;
    den = -den;
  }
  const g = gcd(num, den);
  return { n: num / g, d: den / g };
}

const RAT_ZERO: Rational = { n: 0, d: 1 };
const RAT_ONE: Rational = { n: 1, d: 1 };

export function ratAdd(a: Rational, b: Rational): Rational {
  return rational(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function ratSub(a: Rational, b: Rational): Rational {
  return rational(a.n * b.d - b.n * a.d, a.d * b.d);
}

export function ratMul(a: Rational, b: Rational): Rational {
  return rational(a.n * b.n, a.d * b.d);
}

export function ratNeg(a: Rational): Rational {
  return a.n === 0 ? RAT_ZERO : { n: -a.n, d: a.d };
}

export function ratEq(a: Rational, b: Rational): boolean {
  // Both operands are reduced by construction, so field equality is exact.
  return a.n === b.n && a.d === b.d;
}

export function ratIsZero(a: Rational): boolean {
  return a.n === 0;
}

// ---------------------------------------------------------------------------
// Dimension vectors over the 7 SI base dimensions.
// ---------------------------------------------------------------------------

/**
 * The seven SI base dimensions, in a fixed order that also drives the
 * deterministic {@link formatDimension} output.
 *
 *  - M  mass
 *  - L  length
 *  - T  time
 *  - I  electric current
 *  - Θ  thermodynamic temperature
 *  - N  amount of substance
 *  - J  luminous intensity
 */
export const BASE_DIMENSIONS = ["M", "L", "T", "I", "Θ", "N", "J"] as const;

export type BaseDimension = (typeof BASE_DIMENSIONS)[number];

/** A dimension is the exponent (a {@link Rational}) of each base dimension. */
export type Dimension = Readonly<Record<BaseDimension, Rational>>;

/** The zero vector — the dimension of any pure ratio / count. */
export const DIMENSIONLESS: Dimension = {
  M: RAT_ZERO,
  L: RAT_ZERO,
  T: RAT_ZERO,
  I: RAT_ZERO,
  "Θ": RAT_ZERO,
  N: RAT_ZERO,
  J: RAT_ZERO,
};

/**
 * Build a dimension from the non-zero exponents; unspecified bases are zero.
 * Spreading a {@link Partial} only overrides the keys that are present, so the
 * zero baseline from {@link DIMENSIONLESS} survives for the rest.
 */
export function dimension(
  exponents: Partial<Record<BaseDimension, Rational>>,
): Dimension {
  return { ...DIMENSIONLESS, ...exponents };
}

function combine(
  a: Dimension,
  b: Dimension,
  op: (x: Rational, y: Rational) => Rational,
): Dimension {
  const out: Partial<Record<BaseDimension, Rational>> = {};
  for (const base of BASE_DIMENSIONS) {
    out[base] = op(a[base], b[base]);
  }
  return dimension(out);
}

/** Multiply two dimensions — add exponents base-by-base. */
export function multiplyDimensions(a: Dimension, b: Dimension): Dimension {
  return combine(a, b, ratAdd);
}

/** Divide two dimensions — subtract exponents base-by-base. */
export function divideDimensions(a: Dimension, b: Dimension): Dimension {
  return combine(a, b, ratSub);
}

/** Raise a dimension to a rational power — multiply every exponent. */
export function powerDimension(a: Dimension, exp: Rational): Dimension {
  const out: Partial<Record<BaseDimension, Rational>> = {};
  for (const base of BASE_DIMENSIONS) {
    out[base] = ratMul(a[base], exp);
  }
  return dimension(out);
}

/** Structural equality of two dimensions (exact, over reduced rationals). */
export function dimensionsEqual(a: Dimension, b: Dimension): boolean {
  for (const base of BASE_DIMENSIONS) {
    if (!ratEq(a[base], b[base])) return false;
  }
  return true;
}

export function isDimensionless(a: Dimension): boolean {
  return dimensionsEqual(a, DIMENSIONLESS);
}

function superscriptExponent(e: Rational): string {
  if (e.d === 1) {
    return e.n === 1 ? "" : `^${e.n}`;
  }
  return `^(${e.n}/${e.d})`;
}

/**
 * Deterministic, human-readable rendering for error messages, e.g.
 * pressure → `M·L^-1·T^-2`, dimensionless → `1`, and rationals as `T^(1/2)`.
 * Stable because bases are emitted in the fixed {@link BASE_DIMENSIONS} order.
 */
export function formatDimension(a: Dimension): string {
  const parts: string[] = [];
  for (const base of BASE_DIMENSIONS) {
    const e = a[base];
    if (e.n === 0) continue;
    parts.push(`${base}${superscriptExponent(e)}`);
  }
  return parts.length > 0 ? parts.join("·") : "1";
}

// ---------------------------------------------------------------------------
// QuantityKind → dimension mapping (the 13 registry kinds).
// ---------------------------------------------------------------------------

/**
 * Dimension of each of the 13 registry {@link QuantityKind}s.
 *
 * `humidity` (%RH) is a ratio and is therefore DIMENSIONLESS by design — the
 * "percent relative humidity" is (partial vapour pressure / saturation
 * pressure), a pure number. `torque` and energy share dimension M·L²·T⁻²; that
 * coincidence is physically real and out of scope to disambiguate here.
 */
export const KIND_DIMENSIONS = {
  mass: dimension({ M: RAT_ONE }),
  length: dimension({ L: RAT_ONE }),
  time: dimension({ T: RAT_ONE }),
  temperature: dimension({ "Θ": RAT_ONE }),
  current: dimension({ I: RAT_ONE }),
  force: dimension({ M: RAT_ONE, L: RAT_ONE, T: rational(-2) }),
  pressure: dimension({ M: RAT_ONE, L: rational(-1), T: rational(-2) }),
  voltage: dimension({
    M: RAT_ONE,
    L: rational(2),
    T: rational(-3),
    I: rational(-1),
  }),
  resistance: dimension({
    M: RAT_ONE,
    L: rational(2),
    T: rational(-3),
    I: rational(-2),
  }),
  frequency: dimension({ T: rational(-1) }),
  torque: dimension({ M: RAT_ONE, L: rational(2), T: rational(-2) }),
  volume: dimension({ L: rational(3) }),
  humidity: DIMENSIONLESS,
} as const satisfies Record<QuantityKind, Dimension>;

/**
 * Dimension of a registry token (or any token {@link unitKind} recognises).
 * Returns `null` for tokens with no registry kind — callers that also need
 * free-text composites should use {@link parseUnitExpression}.
 */
export function dimensionForRegistryUnit(unit: unknown): Dimension | null {
  const kind = unitKind(unit);
  return kind ? KIND_DIMENSIONS[kind] : null;
}
