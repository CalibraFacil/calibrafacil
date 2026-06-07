import { NumberBackend } from "../numeric/backend.js";
import type { FormulaAstNode, SafeFunctionName } from "../parser/ast.js";
import { evaluateAst } from "../evaluator/evaluate.js";

function num(value: number | string): FormulaAstNode {
  return { kind: "NumberLiteral", raw: typeof value === "number" ? value.toString() : value };
}

function call(functionName: SafeFunctionName, args: readonly FormulaAstNode[]): FormulaAstNode {
  return { kind: "CallExpression", functionName, args };
}

function unary(operator: "+" | "-", argument: FormulaAstNode): FormulaAstNode {
  if (operator === "+") return argument;
  if (isZero(argument)) return num(0);
  return { kind: "UnaryExpression", operator, argument };
}

function binary(operator: "+" | "-" | "*" | "/" | "^", left: FormulaAstNode, right: FormulaAstNode): FormulaAstNode {
  if (operator === "+") {
    if (isZero(left)) return right;
    if (isZero(right)) return left;
  }
  if (operator === "-") {
    if (isZero(right)) return left;
  }
  if (operator === "*") {
    if (isZero(left) || isZero(right)) return num(0);
    if (isOne(left)) return right;
    if (isOne(right)) return left;
  }
  if (operator === "/") {
    if (isZero(left)) return num(0);
    if (isOne(right)) return left;
  }
  if (operator === "^") {
    if (isZero(right)) return num(1);
    if (isOne(right)) return left;
  }
  return { kind: "BinaryExpression", operator, left, right };
}

function isNumber(node: FormulaAstNode, value: number): boolean {
  return node.kind === "NumberLiteral" && Number(node.raw) === value;
}

function isZero(node: FormulaAstNode): boolean {
  return isNumber(node, 0);
}

function isOne(node: FormulaAstNode): boolean {
  return isNumber(node, 1);
}

export function symbolicDerivative(ast: FormulaAstNode, variable: string): FormulaAstNode | null {
  switch (ast.kind) {
    case "NumberLiteral":
      return num(0);
    case "Variable":
      return num(ast.name === variable ? 1 : 0);
    case "UnaryExpression": {
      const dArg = symbolicDerivative(ast.argument, variable);
      if (dArg === null) return null;
      return ast.operator === "+" ? dArg : unary("-", dArg);
    }
    case "BinaryExpression": {
      const dl = symbolicDerivative(ast.left, variable);
      const dr = symbolicDerivative(ast.right, variable);
      if (dl === null || dr === null) return null;
      switch (ast.operator) {
        case "+": return binary("+", dl, dr);
        case "-": return binary("-", dl, dr);
        case "*": return binary("+", binary("*", dl, ast.right), binary("*", ast.left, dr));
        case "/":
          return binary(
            "/",
            binary("-", binary("*", dl, ast.right), binary("*", ast.left, dr)),
            binary("^", ast.right, num(2))
          );
        case "^": {
          if (ast.right.kind === "NumberLiteral") {
            const exponent = Number(ast.right.raw);
            if (Number.isFinite(exponent)) {
              return binary("*", binary("*", num(exponent), binary("^", ast.left, num(exponent - 1))), dl);
            }
          }
          return binary(
            "*",
            binary("^", ast.left, ast.right),
            binary("+", binary("*", dr, call("log", [ast.left])), binary("*", ast.right, binary("/", dl, ast.left)))
          );
        }
      }
    }
    case "CallExpression": {
      if (ast.args.length !== 1) return null;
      const arg = ast.args[0] as FormulaAstNode;
      const dArg = symbolicDerivative(arg, variable);
      if (dArg === null) return null;
      switch (ast.functionName) {
        case "sqrt":
          return binary("/", dArg, binary("*", num(2), call("sqrt", [arg])));
        case "sin":
          return binary("*", call("cos", [arg]), dArg);
        case "cos":
          return binary("*", unary("-", call("sin", [arg])), dArg);
        case "tan":
          return binary("*", binary("/", num(1), binary("^", call("cos", [arg]), num(2))), dArg);
        case "asin":
          return binary("/", dArg, call("sqrt", [binary("-", num(1), binary("^", arg, num(2)))]));
        case "acos":
          return unary("-", binary("/", dArg, call("sqrt", [binary("-", num(1), binary("^", arg, num(2)))])));
        case "atan":
          return binary("/", dArg, binary("+", num(1), binary("^", arg, num(2))));
        case "log":
          return binary("/", dArg, arg);
        case "log10":
          return binary("/", dArg, binary("*", arg, call("log", [num(10)])));
        case "exp":
          return binary("*", call("exp", [arg]), dArg);
        case "abs":
        case "min":
        case "max":
        case "floor":
        case "ceil":
        case "round":
        case "student_t_inverse_2t":
        case "if_zero":
          return null;
      }
    }
  }
}

export interface NumericalDerivativeOptions {
  readonly maxExponentMagnitude: number;
  readonly decimalPrecision: number;
  readonly relativeStep?: number;
}

export function numericalDerivative(
  ast: FormulaAstNode,
  variable: string,
  estimates: Readonly<Record<string, number>>,
  options: NumericalDerivativeOptions
): number {
  const backend = new NumberBackend(options.decimalPrecision, options.maxExponentMagnitude);
  const x0 = estimates[variable];
  if (x0 === undefined || !Number.isFinite(x0)) {
    throw new Error(`Missing finite estimate for ${variable}`);
  }
  const relativeStep = options.relativeStep ?? 1e-6;
  const h = relativeStep * Math.max(Math.abs(x0), 1);
  const evaluateAt = (offset: number): number => {
    const scope: Record<string, number> = { ...estimates, [variable]: x0 + offset };
    return backend.toNumber(evaluateAst(ast, scope, backend));
  };

  try {
    return (-evaluateAt(2 * h) + 8 * evaluateAt(h) - 8 * evaluateAt(-h) + evaluateAt(-2 * h)) / (12 * h);
  } catch {
    return (evaluateAt(h) - evaluateAt(-h)) / (2 * h);
  }
}
