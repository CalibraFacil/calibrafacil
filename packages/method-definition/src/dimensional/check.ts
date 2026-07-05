/**
 * Unification-based dimensional checker over formula ASTs (DOM-10, slice 2).
 *
 * The checker parses each formula string to a {@link FormulaAstNode} using ONLY
 * the exported math-engine API (`createCalculationEngine().compileFormula(expr)`
 * exposes a public, frozen `.ast`). The validated engine is NEVER modified and no
 * second formula grammar is written here.
 *
 * It then infers a {@link DimExpr} for every node and emits a diagnostic whenever
 * two dimensions that MUST match cannot (`+`/`-`, comparison-like combinators,
 * transcendental arguments, exponents). Numeric literals and unknown units become
 * fresh wildcards, so empirical formulas with dimension-bearing constants (Magnus
 * `243.12 + t[°C]`, Tanaka water density) pass — see {@link ./dim-expr}.
 *
 * ── SAFE_FUNCTIONS classification (math-engine parser/ast.ts) ────────────────
 *  transcendental (arg → dimensionless, result dimensionless):
 *      sin, cos, tan, asin, acos, atan, log, log10, exp
 *  dimension-transforming:
 *      sqrt(x)              → x^(1/2)
 *  dimension-preserving (result = arg dimension):
 *      abs, floor, ceil, round
 *  unify-all-args, result = unified dimension:
 *      min, max
 *  probability/statistics (all args → dimensionless, result dimensionless):
 *      student_t_inverse_2t(alpha, nu)
 *  branch selector `if_zero(test, then, else)` (engine evaluate.ts:83): the test
 *      is a numeric discriminator (dimension unconstrained — recursed for nested
 *      errors only); the two branches unify and give the result dimension.
 *  unknown function (defensive default — cannot occur, the parser only allows the
 *      list above): args recursed for nested errors, result = fresh wildcard.
 */

import { createCalculationEngine } from "@calibra-facil/math-engine";
import type { FormulaAstNode } from "@calibra-facil/math-engine";
import {
  parseUnitExpression,
  rational,
  type Rational,
} from "@calibra-facil/shared/units";

import {
  concreteExpr,
  dimensionlessExpr,
  divExpr,
  formatDimExpr,
  isDimensionlessExpr,
  isFullyConcrete,
  mulExpr,
  powExpr,
  unify,
  wildcardExpr,
  type DimExpr,
} from "./dim-expr";

export type DimensionalDiagnosticCode =
  | "DIMENSIONAL_MISMATCH"
  | "DIMENSIONAL_EXPONENT"
  | "DIMENSIONAL_TRANSCENDENTAL_ARGUMENT"
  | "DIMENSIONAL_RESULT_UNIT";

export interface DimensionalDiagnostic {
  readonly code: DimensionalDiagnosticCode;
  readonly formulaId: string;
  /** pt-BR message ready for the method editor. */
  readonly message: string;
  readonly detail: {
    readonly fragment: string;
    readonly left?: string;
    readonly right?: string;
  };
}

export interface DimensionalFieldInput {
  readonly symbol: string;
  readonly unit?: string | null;
}

export interface DimensionalFormulaInput {
  readonly id: string;
  readonly expression: string;
  readonly resultUnit?: string | null;
  /** Optional extra symbol this formula also binds (e.g. a measurand name). */
  readonly resultSymbol?: string | null;
}

export interface CheckMethodDimensionsInput {
  readonly fields: readonly DimensionalFieldInput[];
  readonly quantities?: readonly DimensionalFieldInput[];
  readonly formulas: readonly DimensionalFormulaInput[];
}

const TRANSCENDENTAL = new Set([
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "log",
  "log10",
  "exp",
]);
const PRESERVING = new Set(["abs", "floor", "ceil", "round"]);

const HALF: Rational = rational(1, 2);

/** Parse a plain decimal/integer literal into an exact rational, else `null`. */
function parseDecimalToRational(raw: string): Rational | null {
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const dot = raw.indexOf(".");
  if (dot === -1) {
    const value = Number(raw);
    return Number.isSafeInteger(value) ? rational(value) : null;
  }
  const fraction = raw.slice(dot + 1);
  const digits = raw.slice(0, dot) + fraction;
  const numerator = Number(digits);
  const denominator = 10 ** fraction.length;
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    return null;
  }
  return rational(numerator, denominator);
}

/** A NumberLiteral (optionally wrapped in a unary sign) → its rational value. */
function numericLiteralRational(node: FormulaAstNode): Rational | null {
  if (node.kind === "NumberLiteral") return parseDecimalToRational(node.raw);
  if (node.kind === "UnaryExpression" && node.argument.kind === "NumberLiteral") {
    const value = parseDecimalToRational(node.argument.raw);
    if (!value) return null;
    return node.operator === "-" ? rational(-value.n, value.d) : value;
  }
  return null;
}

function needsParens(node: FormulaAstNode): boolean {
  return node.kind === "BinaryExpression" || node.kind === "UnaryExpression";
}

/** Reconstruct a readable expression fragment from an AST node for diagnostics. */
function formatAst(node: FormulaAstNode): string {
  switch (node.kind) {
    case "NumberLiteral":
      return node.raw;
    case "Variable":
      return node.name;
    case "UnaryExpression":
      return `${node.operator}${
        needsParens(node.argument)
          ? `(${formatAst(node.argument)})`
          : formatAst(node.argument)
      }`;
    case "BinaryExpression": {
      const left = needsParens(node.left)
        ? `(${formatAst(node.left)})`
        : formatAst(node.left);
      const right = needsParens(node.right)
        ? `(${formatAst(node.right)})`
        : formatAst(node.right);
      return `${left} ${node.operator} ${right}`;
    }
    case "CallExpression":
      return `${node.functionName}(${node.args.map(formatAst).join(", ")})`;
  }
}

interface InferenceContext {
  readonly symbols: Map<string, DimExpr>;
  readonly diagnostics: DimensionalDiagnostic[];
  readonly formulaId: string;
  nextWildcard: number;
}

function fresh(ctx: InferenceContext): DimExpr {
  const id = ctx.nextWildcard;
  ctx.nextWildcard += 1;
  return wildcardExpr(id);
}

function resolveSymbol(ctx: InferenceContext, name: string): DimExpr {
  const existing = ctx.symbols.get(name);
  if (existing) return existing;
  const created = fresh(ctx);
  ctx.symbols.set(name, created);
  return created;
}

function addDiagnostic(
  ctx: InferenceContext,
  code: DimensionalDiagnosticCode,
  message: string,
  fragment: string,
  left?: string,
  right?: string,
): void {
  ctx.diagnostics.push({
    code,
    formulaId: ctx.formulaId,
    message,
    detail: { fragment, ...(left ? { left } : {}), ...(right ? { right } : {}) },
  });
}

function inferBinary(
  ctx: InferenceContext,
  node: Extract<FormulaAstNode, { kind: "BinaryExpression" }>,
): DimExpr {
  const left = infer(ctx, node.left);
  if (node.operator === "*") return mulExpr(left, infer(ctx, node.right));
  if (node.operator === "/") return divExpr(left, infer(ctx, node.right));
  if (node.operator === "+" || node.operator === "-") {
    const right = infer(ctx, node.right);
    const result = unify(left, right);
    if (!result.ok) {
      addDiagnostic(
        ctx,
        "DIMENSIONAL_MISMATCH",
        `Soma/subtração combina grandezas de dimensões incompatíveis (${formatDimExpr(left)} e ${formatDimExpr(right)}).`,
        formatAst(node),
        formatDimExpr(left),
        formatDimExpr(right),
      );
    }
    return result.dim;
  }
  // node.operator === "^"
  const exponent = infer(ctx, node.right);
  const exponentDimensionless = unify(exponent, dimensionlessExpr());
  if (!exponentDimensionless.ok) {
    addDiagnostic(
      ctx,
      "DIMENSIONAL_EXPONENT",
      `O expoente deve ser adimensional, mas tem dimensão ${formatDimExpr(exponent)}.`,
      formatAst(node),
      formatDimExpr(exponent),
    );
    return fresh(ctx);
  }
  const literalExponent = numericLiteralRational(node.right);
  if (isFullyConcrete(left) && !isDimensionlessExpr(left)) {
    if (literalExponent) return powExpr(left, literalExponent);
    addDiagnostic(
      ctx,
      "DIMENSIONAL_EXPONENT",
      `Base dimensional (${formatDimExpr(left)}) elevada a um expoente variável — o expoente de uma grandeza dimensional deve ser um literal racional.`,
      formatAst(node),
      formatDimExpr(left),
    );
    return fresh(ctx);
  }
  if (isFullyConcrete(left)) return dimensionlessExpr();
  if (literalExponent) return powExpr(left, literalExponent);
  return fresh(ctx);
}

function inferCall(
  ctx: InferenceContext,
  node: Extract<FormulaAstNode, { kind: "CallExpression" }>,
): DimExpr {
  const fn = node.functionName;

  if (TRANSCENDENTAL.has(fn)) {
    const arg = node.args[0];
    const argDim = arg ? infer(ctx, arg) : dimensionlessExpr();
    if (!unify(argDim, dimensionlessExpr()).ok) {
      addDiagnostic(
        ctx,
        "DIMENSIONAL_TRANSCENDENTAL_ARGUMENT",
        `O argumento de ${fn}() deve ser adimensional, mas tem dimensão ${formatDimExpr(argDim)}.`,
        formatAst(node),
        formatDimExpr(argDim),
      );
    }
    return dimensionlessExpr();
  }

  if (fn === "sqrt") {
    const arg = node.args[0];
    const argDim = arg ? infer(ctx, arg) : dimensionlessExpr();
    return powExpr(argDim, HALF);
  }

  if (PRESERVING.has(fn)) {
    const arg = node.args[0];
    return arg ? infer(ctx, arg) : dimensionlessExpr();
  }

  if (fn === "min" || fn === "max") {
    let acc: DimExpr | null = null;
    for (const arg of node.args) {
      const argDim = infer(ctx, arg);
      if (acc === null) {
        acc = argDim;
        continue;
      }
      const result = unify(acc, argDim);
      if (!result.ok) {
        addDiagnostic(
          ctx,
          "DIMENSIONAL_MISMATCH",
          `${fn}() combina grandezas de dimensões incompatíveis (${formatDimExpr(acc)} e ${formatDimExpr(argDim)}).`,
          formatAst(node),
          formatDimExpr(acc),
          formatDimExpr(argDim),
        );
      }
      acc = result.dim;
    }
    return acc ?? dimensionlessExpr();
  }

  if (fn === "student_t_inverse_2t") {
    for (const arg of node.args) {
      const argDim = infer(ctx, arg);
      if (!unify(argDim, dimensionlessExpr()).ok) {
        addDiagnostic(
          ctx,
          "DIMENSIONAL_TRANSCENDENTAL_ARGUMENT",
          `Os argumentos de student_t_inverse_2t() devem ser adimensionais, mas um tem dimensão ${formatDimExpr(argDim)}.`,
          formatAst(node),
          formatDimExpr(argDim),
        );
      }
    }
    return dimensionlessExpr();
  }

  if (fn === "if_zero") {
    // args[0] is the numeric discriminator: recurse for nested errors only.
    if (node.args[0]) infer(ctx, node.args[0]);
    const thenNode = node.args[1];
    const elseNode = node.args[2];
    const thenDim = thenNode ? infer(ctx, thenNode) : dimensionlessExpr();
    const elseDim = elseNode ? infer(ctx, elseNode) : dimensionlessExpr();
    const result = unify(thenDim, elseDim);
    if (!result.ok) {
      addDiagnostic(
        ctx,
        "DIMENSIONAL_MISMATCH",
        `Os ramos de if_zero() têm dimensões incompatíveis (${formatDimExpr(thenDim)} e ${formatDimExpr(elseDim)}).`,
        formatAst(node),
        formatDimExpr(thenDim),
        formatDimExpr(elseDim),
      );
    }
    return result.dim;
  }

  // Unknown function (defensive — the parser never emits one).
  for (const arg of node.args) infer(ctx, arg);
  return fresh(ctx);
}

function infer(ctx: InferenceContext, node: FormulaAstNode): DimExpr {
  switch (node.kind) {
    case "NumberLiteral":
      return fresh(ctx);
    case "Variable":
      return resolveSymbol(ctx, node.name);
    case "UnaryExpression":
      return infer(ctx, node.argument);
    case "BinaryExpression":
      return inferBinary(ctx, node);
    case "CallExpression":
      return inferCall(ctx, node);
  }
}

function unitDimExpr(unit: string | null | undefined): DimExpr | null {
  if (typeof unit !== "string" || unit.trim() === "") return null;
  const parsed = parseUnitExpression(unit);
  return parsed.ok ? concreteExpr(parsed.dimension) : null;
}

const engine = createCalculationEngine();

function parseAst(expression: string): FormulaAstNode | null {
  try {
    return engine.compileFormula(expression).ast;
  } catch {
    // Not a dimensional concern — the compile step of the real pipeline reports
    // syntactic/limit errors. Skipping keeps the checker sound.
    return null;
  }
}

/**
 * Infer and unify dimensions across a method's declared fields, measurement-model
 * quantities and formulas. Returns an empty array when the method is coherent.
 */
export function checkMethodDimensions(
  input: CheckMethodDimensionsInput,
): DimensionalDiagnostic[] {
  const diagnostics: DimensionalDiagnostic[] = [];
  const symbols = new Map<string, DimExpr>();
  let nextWildcard = 0;

  const declare = (entry: DimensionalFieldInput): void => {
    const concrete = unitDimExpr(entry.unit);
    const existing = symbols.get(entry.symbol);
    if (concrete) {
      // A parseable unit is authoritative and overrides an earlier wildcard.
      symbols.set(entry.symbol, concrete);
    } else if (!existing) {
      // Unknown/missing unit → one stable wildcard per symbol.
      nextWildcard += 1;
      symbols.set(entry.symbol, wildcardExpr(nextWildcard - 1));
    }
  };

  for (const field of input.fields) declare(field);
  for (const quantity of input.quantities ?? []) declare(quantity);

  for (const formula of input.formulas) {
    const ast = parseAst(formula.expression);
    if (!ast) continue;

    const ctx: InferenceContext = {
      symbols,
      diagnostics,
      formulaId: formula.id,
      nextWildcard,
    };
    const inferred = infer(ctx, ast);
    nextWildcard = ctx.nextWildcard;

    const declaredResult = unitDimExpr(formula.resultUnit);
    if (declaredResult) {
      const result = unify(inferred, declaredResult);
      if (!result.ok) {
        diagnostics.push({
          code: "DIMENSIONAL_RESULT_UNIT",
          formulaId: formula.id,
          message: `A dimensão calculada (${formatDimExpr(inferred)}) não corresponde à unidade declarada do resultado (${formatDimExpr(declaredResult)}).`,
          detail: {
            fragment: formula.expression,
            left: formatDimExpr(inferred),
            right: formatDimExpr(declaredResult),
          },
        });
      }
    }

    // Bind this formula's output symbol(s) for later formulas that reference it.
    const symbolDim = symbolDimensionForResult(declaredResult, inferred, () => {
      nextWildcard += 1;
      return wildcardExpr(nextWildcard - 1);
    });
    symbols.set(formula.id, symbolDim);
    if (formula.resultSymbol) symbols.set(formula.resultSymbol, symbolDim);
  }

  return diagnostics;
}

function symbolDimensionForResult(
  declaredResult: DimExpr | null,
  inferred: DimExpr,
  freshWildcard: () => DimExpr,
): DimExpr {
  if (declaredResult) return declaredResult;
  if (isFullyConcrete(inferred)) return inferred;
  return freshWildcard();
}
