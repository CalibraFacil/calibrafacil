/**
 * Dimension EXPRESSIONS for the unification-based checker (DOM-10, slice 2).
 *
 * The slice-1 {@link Dimension} is a fixed vector of rational exponents. That is
 * enough for a fully-declared quantity, but the checker also has to reason about
 * quantities whose dimension is UNKNOWN (a numeric literal, a free-text unit that
 * did not parse) and let the surrounding formula pin them by context — the
 * "Magnus rule" that keeps empirical formulas (`243.12 + t[°C]`, Tanaka water
 * density) from firing false positives.
 *
 * A {@link DimExpr} is therefore a concrete {@link Dimension} PLUS a multiset of
 * WILDCARD references with rational exponents. Wildcards are the unknowns:
 *
 *   D = concrete · Π wildcardᵢ^expᵢ
 *
 * Multiplication adds the exponent vectors (concrete and wildcard alike),
 * division subtracts them, and raising to a rational power multiplies them.
 *
 * Unification (`unify`) is the crux and is deliberately SOUND, not complete:
 * given `A` and `B` that must share a dimension, it forms `D = A / B` and asks
 * whether `D` can be made dimensionless.
 *   - No free wildcard in `D` ⇒ it is coherent iff the concrete part is
 *     dimensionless; otherwise it is a real mismatch (a diagnostic).
 *   - One or more free wildcards in `D` ⇒ the system is solvable (bind the
 *     wildcards), so it is treated as COHERENT and never a diagnostic. Bindings
 *     are not propagated across nodes — that only costs completeness (a missed
 *     error), never soundness (a false error). This is documented on purpose.
 */

import {
  DIMENSIONLESS,
  divideDimensions,
  formatDimension,
  isDimensionless,
  multiplyDimensions,
  powerDimension,
  ratIsZero,
  ratMul,
  ratSub,
  type Dimension,
  type Rational,
} from "@calibra-facil/shared/units";

/** A concrete dimension multiplied by a multiset of unknown (wildcard) factors. */
export interface DimExpr {
  readonly concrete: Dimension;
  /** wildcard id → rational exponent (zero exponents are always pruned). */
  readonly wildcards: ReadonlyMap<number, Rational>;
}

const NO_WILDCARDS: ReadonlyMap<number, Rational> = new Map();

/** A fully-known dimension (no unknown factors). */
export function concreteExpr(concrete: Dimension): DimExpr {
  return { concrete, wildcards: NO_WILDCARDS };
}

/** The dimensionless expression `1` (no unknowns). */
export function dimensionlessExpr(): DimExpr {
  return concreteExpr(DIMENSIONLESS);
}

/** A single fresh unknown factor — the dimension a caller could not determine. */
export function wildcardExpr(id: number): DimExpr {
  return { concrete: DIMENSIONLESS, wildcards: new Map([[id, { n: 1, d: 1 }]]) };
}

function pruneWildcards(
  entries: Iterable<readonly [number, Rational]>,
): ReadonlyMap<number, Rational> {
  const out = new Map<number, Rational>();
  for (const [id, exp] of entries) {
    if (!ratIsZero(exp)) out.set(id, exp);
  }
  return out;
}

function combineWildcards(
  a: ReadonlyMap<number, Rational>,
  b: ReadonlyMap<number, Rational>,
  op: (x: Rational, y: Rational) => Rational,
): ReadonlyMap<number, Rational> {
  const ZERO: Rational = { n: 0, d: 1 };
  const ids = new Set<number>([...a.keys(), ...b.keys()]);
  const merged: Array<readonly [number, Rational]> = [];
  for (const id of ids) {
    merged.push([id, op(a.get(id) ?? ZERO, b.get(id) ?? ZERO)]);
  }
  return pruneWildcards(merged);
}

/** Multiply two dimension expressions (add every exponent). */
export function mulExpr(a: DimExpr, b: DimExpr): DimExpr {
  return {
    concrete: multiplyDimensions(a.concrete, b.concrete),
    wildcards: combineWildcards(a.wildcards, b.wildcards, (x, y) => ({
      n: x.n * y.d + y.n * x.d,
      d: x.d * y.d,
    })),
  };
}

/** Divide two dimension expressions (subtract every exponent). */
export function divExpr(a: DimExpr, b: DimExpr): DimExpr {
  return {
    concrete: divideDimensions(a.concrete, b.concrete),
    wildcards: combineWildcards(a.wildcards, b.wildcards, ratSub),
  };
}

/** Raise a dimension expression to a rational power (scale every exponent). */
export function powExpr(a: DimExpr, exp: Rational): DimExpr {
  return {
    concrete: powerDimension(a.concrete, exp),
    wildcards: pruneWildcards(
      [...a.wildcards.entries()].map(([id, e]) => [id, ratMul(e, exp)]),
    ),
  };
}

function nonZeroWildcards(e: DimExpr): number {
  let count = 0;
  for (const exp of e.wildcards.values()) {
    if (!ratIsZero(exp)) count += 1;
  }
  return count;
}

/** True when the expression carries no unknown factors. */
export function isFullyConcrete(e: DimExpr): boolean {
  return nonZeroWildcards(e) === 0;
}

/** True when the expression is exactly `1` (concrete and dimensionless). */
export function isDimensionlessExpr(e: DimExpr): boolean {
  return isFullyConcrete(e) && isDimensionless(e.concrete);
}

export interface UnifyResult {
  readonly ok: boolean;
  /** The best resolved dimension for the unified node (used for propagation). */
  readonly dim: DimExpr;
}

function preferConcrete(a: DimExpr, b: DimExpr): DimExpr {
  if (isFullyConcrete(a)) return a;
  if (isFullyConcrete(b)) return b;
  return a;
}

/**
 * Attempt to unify two dimension expressions that must share a dimension. Sound
 * by construction: only a fully-concrete, non-dimensionless residue is reported
 * as a mismatch; any free wildcard makes the system solvable (coherent).
 */
export function unify(a: DimExpr, b: DimExpr): UnifyResult {
  const residue = divExpr(a, b);
  if (nonZeroWildcards(residue) === 0) {
    if (isDimensionless(residue.concrete)) {
      return { ok: true, dim: preferConcrete(a, b) };
    }
    return { ok: false, dim: a };
  }
  return { ok: true, dim: preferConcrete(a, b) };
}

/** Human-readable rendering for diagnostics (pt-BR friendly). */
export function formatDimExpr(e: DimExpr): string {
  const base = formatDimension(e.concrete);
  if (isFullyConcrete(e)) return base;
  return base === "1" ? "⟨indeterminado⟩" : `${base}·⟨indeterminado⟩`;
}
