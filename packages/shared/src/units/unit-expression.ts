/**
 * Unit-EXPRESSION parser (DOM-10, slice 1).
 *
 * Real method units are free text well beyond the registry token list: `hPa`,
 * `N·m`, `m/s²`, `µm/(m·K)`, `kgf/cm²`, `mV/V`. This module parses those into a
 * {@link Dimension} using the same vocabulary as {@link ./registry} — it never
 * forks a parallel unit list; unknown atoms fall through to the registry's
 * {@link normalizeUnitToken} first, then to a small base-atom + SI-prefix table.
 *
 * Result-style, never throws to the caller: the return value distinguishes
 * "parsed, possibly dimensionless" (`ok: true`) from "unknown / unparseable"
 * (`ok: false`). Slice 2 (the AST checker) decides wildcard semantics; this
 * layer only reports what it could resolve.
 *
 * Prefix-ambiguity rule (documented + tested): inside a SINGLE token with no
 * separator, the prefix interpretation wins — `mN` is millinewton, `mV` is
 * millivolt. To mean metre·newton you must write it with a separator: `m·N`.
 *
 * Factor note: SI prefix factors (h = 100, k = 1000) matter for CONVERSION, not
 * for dimension. This slice only needs dimensions, but the parse result carries
 * a best-effort `factor` for a future conversion-cleanup slice. It is NOT
 * authoritative (whole-token registry hits report 1) and must not be relied on.
 */

import {
  type BaseDimension,
  type Dimension,
  type Rational,
} from "./dimensions";
import {
  DIMENSIONLESS,
  dimension,
  dimensionForRegistryUnit,
  divideDimensions,
  multiplyDimensions,
  powerDimension,
  rational,
} from "./dimensions";
import { normalizeUnitToken } from "./registry";

export type UnitParseResult =
  | {
      readonly ok: true;
      readonly dimension: Dimension;
      readonly factor: number;
    }
  | { readonly ok: false; readonly reason: string };

interface Resolved {
  readonly dimension: Dimension;
  readonly factor: number;
}

/** Internal sentinel so the recursive descent can bail without leaking throws. */
class UnparseableError extends Error {}

// ---------------------------------------------------------------------------
// Base atoms — dimensions of unprefixed unit symbols, including named derived
// units the registry does not carry (Pa, J, W, s, m as metre, mol, cd…). These
// are only consulted after normalizeUnitToken(), so registry aliasing wins.
// ---------------------------------------------------------------------------

function dimForKind(...pairs: Array<[BaseDimension, number]>): Dimension {
  const exponents: Partial<Record<BaseDimension, Rational>> = {};
  for (const [base, exp] of pairs) {
    exponents[base] = rational(exp);
  }
  return dimension(exponents);
}

const MASS = dimForKind(["M", 1]);
const LENGTH = dimForKind(["L", 1]);
const TIME = dimForKind(["T", 1]);
const CURRENT = dimForKind(["I", 1]);
const TEMPERATURE = dimForKind(["Θ", 1]);
const AMOUNT = dimForKind(["N", 1]);
const LUMINOUS = dimForKind(["J", 1]);
const FORCE = dimForKind(["M", 1], ["L", 1], ["T", -2]);
const PRESSURE = dimForKind(["M", 1], ["L", -1], ["T", -2]);
const ENERGY = dimForKind(["M", 1], ["L", 2], ["T", -2]);
const POWER = dimForKind(["M", 1], ["L", 2], ["T", -3]);
const VOLTAGE = dimForKind(["M", 1], ["L", 2], ["T", -3], ["I", -1]);
const RESISTANCE = dimForKind(["M", 1], ["L", 2], ["T", -3], ["I", -2]);
const FREQUENCY = dimForKind(["T", -1]);

const BASE_ATOMS: Record<string, Dimension> = {
  // SI base symbols (metre/second/ampere/kelvin/mole/candela; gram is the mass
  // atom to match the registry — kg is then k+g via the prefix table).
  g: MASS,
  m: LENGTH,
  s: TIME,
  A: CURRENT,
  K: TEMPERATURE,
  mol: AMOUNT,
  cd: LUMINOUS,
  // temperature spellings (offset is a conversion concern, dimension is Θ)
  "°C": TEMPERATURE,
  "°F": TEMPERATURE,
  // named derived / common units
  N: FORCE,
  kgf: FORCE,
  Pa: PRESSURE,
  bar: PRESSURE,
  psi: PRESSURE,
  mmHg: PRESSURE,
  inHg: PRESSURE,
  J: ENERGY,
  W: POWER,
  V: VOLTAGE,
  Ω: RESISTANCE,
  ohm: RESISTANCE,
  Hz: FREQUENCY,
  rpm: FREQUENCY,
  L: dimForKind(["L", 3]),
  min: TIME,
  h: TIME,
  // explicit dimensionless tokens
  "%": DIMENSIONLESS,
  ppm: DIMENSIONLESS,
  ppb: DIMENSIONLESS,
  rad: DIMENSIONLESS,
  sr: DIMENSIONLESS,
};

// SI prefixes (case-sensitive). Order matters only for the 2-char "da"/"1-char"
// split, handled by trying "da" first in resolveAtom. µ (U+00B5), μ (U+03BC)
// and ASCII "u" all mean micro, mirroring the registry's normalization.
const SI_PREFIXES: Record<string, number> = {
  y: 1e-24,
  z: 1e-21,
  a: 1e-18,
  f: 1e-15,
  p: 1e-12,
  n: 1e-9,
  µ: 1e-6,
  μ: 1e-6,
  u: 1e-6,
  m: 1e-3,
  c: 1e-2,
  d: 1e-1,
  da: 1e1,
  h: 1e2,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
  Z: 1e21,
  Y: 1e24,
};

function resolveBareAtom(atom: string): Dimension | null {
  const normalized = normalizeUnitToken(atom);
  if (normalized) {
    return dimensionForRegistryUnit(normalized);
  }
  return BASE_ATOMS[atom] ?? null;
}

/**
 * Resolve a single atom to a dimension + best-effort factor. Whole-token
 * readings (registry alias, then base-atom table) are tried first; only when
 * those fail does a prefix decomposition run — which is exactly the case where
 * the prefix reading is the intended one (`mN`, `hPa`).
 */
function resolveAtom(atom: string): Resolved | null {
  const whole = resolveBareAtom(atom);
  if (whole) {
    return { dimension: whole, factor: 1 };
  }
  // Prefix decomposition — try the 2-char "da" before the 1-char prefixes.
  for (const prefixLen of [2, 1]) {
    if (atom.length <= prefixLen) continue;
    const factor = SI_PREFIXES[atom.slice(0, prefixLen)];
    if (factor === undefined) continue;
    const rest = resolveBareAtom(atom.slice(prefixLen));
    if (rest) {
      return { dimension: rest, factor };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tokenizer.
// ---------------------------------------------------------------------------

const SUPERSCRIPTS: Record<string, string> = {
  "⁰": "0",
  "¹": "1",
  "²": "2",
  "³": "3",
  "⁴": "4",
  "⁵": "5",
  "⁶": "6",
  "⁷": "7",
  "⁸": "8",
  "⁹": "9",
  "⁻": "-",
  "⁺": "+",
};

/** Rewrite Unicode superscript runs into caret exponents: `s²` → `s^2`. */
function normalizeSuperscripts(input: string): string {
  return input.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, (run) => {
    let out = "^";
    for (const ch of run) {
      out += SUPERSCRIPTS[ch] ?? "";
    }
    return out;
  });
}

type Token =
  | { readonly t: "atom"; readonly atom: string; readonly impliedExp: number }
  | { readonly t: "num"; readonly value: number }
  | { readonly t: "mul" }
  | { readonly t: "div" }
  | { readonly t: "caret" }
  | { readonly t: "sign"; readonly sign: 1 | -1 }
  | { readonly t: "lp" }
  | { readonly t: "rp" };

const MUL_CHARS = new Set([" ", "\t", "·", "*", "×", "."]);
const DIGITS = new Set("0123456789");

function isAtomChar(ch: string): boolean {
  // Letters, Greek Ω/µ/μ, the degree sign, and percent — never digits, which
  // are exponents or numeric literals, and never separators.
  return /[A-Za-z]/.test(ch) || "Ωµμ°%".includes(ch);
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;
  const at = (index: number): string => input.charAt(index);
  while (i < n) {
    const ch = at(i);
    if (MUL_CHARS.has(ch)) {
      // Collapse runs of separators into a single multiplication.
      const last = tokens[tokens.length - 1];
      if (last && last.t !== "mul") {
        tokens.push({ t: "mul" });
      }
      i++;
      continue;
    }
    if (ch === "/") {
      tokens.push({ t: "div" });
      i++;
      continue;
    }
    if (ch === "^") {
      tokens.push({ t: "caret" });
      i++;
      continue;
    }
    if (ch === "-" || ch === "+") {
      tokens.push({ t: "sign", sign: ch === "-" ? -1 : 1 });
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ t: "lp" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ t: "rp" });
      i++;
      continue;
    }
    if (DIGITS.has(ch)) {
      let j = i;
      let digits = "";
      while (j < n && DIGITS.has(at(j))) {
        digits += at(j);
        j++;
      }
      if (j < n && at(j) === "." && j + 1 < n && DIGITS.has(at(j + 1))) {
        digits += ".";
        j++;
        while (j < n && DIGITS.has(at(j))) {
          digits += at(j);
          j++;
        }
      }
      tokens.push({ t: "num", value: Number(digits) });
      i = j;
      continue;
    }
    if (isAtomChar(ch)) {
      let j = i;
      let atom = "";
      while (j < n && isAtomChar(at(j))) {
        atom += at(j);
        j++;
      }
      // An immediately-adjacent digit run (no separator, no caret) is an
      // implicit positive exponent: `cm2` → cm², `m3` → m³.
      let impliedExp = 1;
      if (j < n && DIGITS.has(at(j))) {
        let digits = "";
        while (j < n && DIGITS.has(at(j))) {
          digits += at(j);
          j++;
        }
        impliedExp = Number(digits);
      }
      tokens.push({ t: "atom", atom, impliedExp });
      i = j;
      continue;
    }
    throw new UnparseableError(`unexpected character "${ch}"`);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Recursive-descent parser over the token stream.
// ---------------------------------------------------------------------------

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token {
    const token = this.tokens[this.pos];
    if (!token) throw new UnparseableError("unexpected end of expression");
    this.pos++;
    return token;
  }

  atEnd(): boolean {
    return this.pos >= this.tokens.length;
  }

  parseExpr(): Resolved {
    let acc = this.parseFactor();
    while (true) {
      const token = this.peek();
      if (token?.t === "mul") {
        this.next();
        const rhs = this.parseFactor();
        acc = {
          dimension: multiplyDimensions(acc.dimension, rhs.dimension),
          factor: acc.factor * rhs.factor,
        };
      } else if (token?.t === "div") {
        this.next();
        const rhs = this.parseFactor();
        acc = {
          dimension: divideDimensions(acc.dimension, rhs.dimension),
          factor: rhs.factor === 0 ? acc.factor : acc.factor / rhs.factor,
        };
      } else {
        break;
      }
    }
    return acc;
  }

  private parseFactor(): Resolved {
    const base = this.parsePrimary();
    const token = this.peek();
    if (token?.t === "caret") {
      this.next();
      const exp = this.parseExponent();
      return {
        dimension: powerDimension(base.dimension, exp),
        factor: Math.pow(base.factor, exp.n / exp.d),
      };
    }
    return base;
  }

  private parsePrimary(): Resolved {
    const token = this.next();
    if (token.t === "lp") {
      const inner = this.parseExpr();
      const close = this.next();
      if (close.t !== "rp") {
        throw new UnparseableError("expected closing parenthesis");
      }
      return inner;
    }
    if (token.t === "num") {
      // A numeric literal (including the unit "1") is dimensionless.
      return { dimension: DIMENSIONLESS, factor: token.value };
    }
    if (token.t === "atom") {
      const resolved = resolveAtom(token.atom);
      if (!resolved) {
        throw new UnparseableError(`unknown unit atom "${token.atom}"`);
      }
      if (token.impliedExp === 1) {
        return resolved;
      }
      const exp = rational(token.impliedExp);
      return {
        dimension: powerDimension(resolved.dimension, exp),
        factor: Math.pow(resolved.factor, token.impliedExp),
      };
    }
    throw new UnparseableError(`unexpected token "${token.t}"`);
  }

  private parseExponent(): Rational {
    let sign = 1;
    let token = this.next();
    if (token.t === "sign") {
      sign = token.sign;
      token = this.next();
    }
    if (token.t !== "num" || !Number.isInteger(token.value)) {
      throw new UnparseableError("exponent must be an integer");
    }
    return rational(sign * token.value);
  }
}

/**
 * Parse a free-text unit expression into a {@link Dimension}. Never throws:
 * returns `{ ok: false }` for empty, gibberish, or syntactically malformed
 * input, and `{ ok: true, dimension }` otherwise (the dimension may be the zero
 * vector, i.e. dimensionless — check with {@link isDimensionless}).
 */
export function parseUnitExpression(input: unknown): UnitParseResult {
  if (typeof input !== "string") {
    return { ok: false, reason: "input is not a string" };
  }
  const trimmed = input.trim();
  if (trimmed === "") {
    return { ok: false, reason: "empty expression" };
  }
  try {
    const tokens = tokenize(normalizeSuperscripts(trimmed));
    if (tokens.length === 0) {
      return { ok: false, reason: "no tokens" };
    }
    const parser = new Parser(tokens);
    const result = parser.parseExpr();
    if (!parser.atEnd()) {
      return { ok: false, reason: "trailing tokens after a complete unit" };
    }
    return { ok: true, dimension: result.dimension, factor: result.factor };
  } catch (error) {
    if (error instanceof UnparseableError) {
      return { ok: false, reason: error.message };
    }
    throw error;
  }
}

export { BASE_ATOMS, SI_PREFIXES };
