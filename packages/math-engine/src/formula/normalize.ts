import type { CanonicalJsonValue } from "../audit/canonical-json.js";
import { canonicalJson } from "../audit/canonical-json.js";
import { DeterministicDecimal, type DecimalParseOptions } from "../numeric/decimal.js";
import type { FormulaAstNode } from "../parser/ast.js";

export function normalizeNumberLiteral(raw: string, options?: DecimalParseOptions): string {
  return DeterministicDecimal.parse(raw, "number literal", options).toCanonicalString(18);
}

export function astToCanonicalValue(ast: FormulaAstNode, options?: DecimalParseOptions): CanonicalJsonValue {
  switch (ast.kind) {
    case "NumberLiteral":
      return { kind: "NumberLiteral", value: normalizeNumberLiteral(ast.raw, options) };
    case "Variable":
      return { kind: "Variable", name: ast.name };
    case "UnaryExpression":
      return { kind: "UnaryExpression", operator: ast.operator, argument: astToCanonicalValue(ast.argument, options) };
    case "BinaryExpression":
      return {
        kind: "BinaryExpression",
        operator: ast.operator,
        left: astToCanonicalValue(ast.left, options),
        right: astToCanonicalValue(ast.right, options)
      };
    case "CallExpression":
      return {
        kind: "CallExpression",
        functionName: ast.functionName,
        args: ast.args.map((arg) => astToCanonicalValue(arg, options))
      };
  }
}

export function normalizeAst(ast: FormulaAstNode, options?: DecimalParseOptions): string {
  return canonicalJson(astToCanonicalValue(ast, options));
}

export function formatNormalizedFormula(ast: FormulaAstNode, options?: DecimalParseOptions): string {
  switch (ast.kind) {
    case "NumberLiteral":
      return normalizeNumberLiteral(ast.raw, options);
    case "Variable":
      return ast.name;
    case "UnaryExpression":
      return `(${ast.operator}${formatNormalizedFormula(ast.argument, options)})`;
    case "BinaryExpression":
      return `(${formatNormalizedFormula(ast.left, options)} ${ast.operator} ${formatNormalizedFormula(ast.right, options)})`;
    case "CallExpression":
      return `${ast.functionName}(${ast.args.map((arg) => formatNormalizedFormula(arg, options)).join(",")})`;
  }
}
