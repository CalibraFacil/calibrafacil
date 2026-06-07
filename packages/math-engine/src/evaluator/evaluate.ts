import { ERROR_CODES } from "../errors/codes.js";
import { makeError } from "../errors/errors.js";
import { studentTQuantile } from "../gum/statistics.js";
import type { NumericBackend } from "../numeric/types.js";
import type { FormulaAstNode } from "../parser/ast.js";

export type NumericScope<T> = Readonly<Record<string, T>>;

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function evaluateTInv<T>(alphaInput: T, degreesOfFreedomInput: T, backend: NumericBackend<T>): T {
  const alpha = backend.toNumber(alphaInput);
  if (!(alpha > 0 && alpha < 1)) {
    throw makeError(ERROR_CODES.INVALID_PROBABILITY, "student_t_inverse_2t alpha must be a two-tailed probability in the open interval (0, 1).", {
      functionName: "student_t_inverse_2t",
      alpha: String(alpha)
    });
  }
  const degreesOfFreedom = Math.trunc(backend.toNumber(degreesOfFreedomInput));
  return backend.fromNumber(studentTQuantile(1 - alpha / 2, degreesOfFreedom), "student_t_inverse_2t result");
}

export function evaluateAst<T>(ast: FormulaAstNode, scope: NumericScope<T>, backend: NumericBackend<T>): T {
  switch (ast.kind) {
    case "NumberLiteral":
      return backend.fromNumberLiteral(ast.raw);
    case "Variable":
      if (!hasOwn(scope, ast.name)) {
        throw makeError(ERROR_CODES.MISSING_INPUT, "Formula input is missing a required variable.", {
          identifier: ast.name
        });
      }
      return scope[ast.name] as T;
    case "UnaryExpression": {
      const value = evaluateAst(ast.argument, scope, backend);
      return ast.operator === "+" ? value : backend.neg(value);
    }
    case "BinaryExpression": {
      const left = evaluateAst(ast.left, scope, backend);
      const right = evaluateAst(ast.right, scope, backend);
      switch (ast.operator) {
        case "+": return backend.add(left, right);
        case "-": return backend.sub(left, right);
        case "*": return backend.mul(left, right);
        case "/": return backend.div(left, right);
        case "^": return backend.pow(left, right);
      }
    }
    case "CallExpression": {
      if (ast.functionName === "if_zero") {
        const discriminator = evaluateAst(ast.args[0] as FormulaAstNode, scope, backend);
        return backend.isZero(discriminator)
          ? evaluateAst(ast.args[1] as FormulaAstNode, scope, backend)
          : evaluateAst(ast.args[2] as FormulaAstNode, scope, backend);
      }
      const args = ast.args.map((arg) => evaluateAst(arg, scope, backend));
      switch (ast.functionName) {
        case "sqrt": return backend.sqrt(args[0] as T);
        case "abs": return backend.abs(args[0] as T);
        case "sin": return backend.sin(args[0] as T);
        case "cos": return backend.cos(args[0] as T);
        case "tan": return backend.tan(args[0] as T);
        case "asin": return backend.asin(args[0] as T);
        case "acos": return backend.acos(args[0] as T);
        case "atan": return backend.atan(args[0] as T);
        case "log": return backend.log(args[0] as T);
        case "log10": return backend.log10(args[0] as T);
        case "exp": return backend.exp(args[0] as T);
        case "min": return backend.min(args);
        case "max": return backend.max(args);
        case "floor": return backend.floor(args[0] as T);
        case "ceil": return backend.ceil(args[0] as T);
        case "round": return backend.round(args[0] as T);
        case "student_t_inverse_2t": return evaluateTInv(args[0] as T, args[1] as T, backend);
      }
    }
  }
}
