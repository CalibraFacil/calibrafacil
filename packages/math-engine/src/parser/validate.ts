import { ERROR_CODES } from "../errors/codes.js";
import { makeError } from "../errors/errors.js";
import type { FormulaAstNode } from "./ast.js";
import { FUNCTION_ARITY } from "./ast.js";
import { assertSafeIdentifier } from "./identifiers.js";
import { validateNumericString } from "../numeric/validation.js";
import type { FormulaLimits } from "./options.js";

export interface AstValidationResult {
  readonly nodeCount: number;
  readonly depth: number;
  readonly variables: readonly string[];
}

export interface AstValidationOptions {
  readonly allowedVariables?: ReadonlySet<string>;
}

export function validateAst(
  ast: FormulaAstNode,
  limits: FormulaLimits,
  options: AstValidationOptions = {}
): AstValidationResult {
  const variables = new Set<string>();
  let nodeCount = 0;
  let maxDepth = 0;

  const visit = (node: FormulaAstNode, depth: number): void => {
    nodeCount += 1;
    maxDepth = Math.max(maxDepth, depth);

    if (nodeCount > limits.maxAstNodes) {
      throw makeError(ERROR_CODES.AST_TOO_LARGE, "Formula AST exceeds the configured node limit.", {
        maxAstNodes: limits.maxAstNodes
      });
    }
    if (depth > limits.maxAstDepth) {
      throw makeError(ERROR_CODES.AST_TOO_DEEP, "Formula AST exceeds the configured depth limit.", {
        maxAstDepth: limits.maxAstDepth
      });
    }

    switch (node.kind) {
      case "NumberLiteral": {
        if (node.raw.length > limits.maxNumberLiteralLength) {
          throw makeError(ERROR_CODES.NUMBER_LITERAL_TOO_LONG, "Number literal exceeds the configured length limit.", {
            literal: node.raw,
            maxNumberLiteralLength: limits.maxNumberLiteralLength
          });
        }
        validateNumericString(node.raw, {
          maxExponentMagnitude: limits.maxExponentMagnitude,
          maxInputLength: limits.maxNumberLiteralLength,
          maxSignificantDigits: limits.maxSignificantDigits ?? limits.maxNumberLiteralLength,
          label: "number literal"
        });
        break;
      }
      case "Variable": {
        assertSafeIdentifier(node.name, limits.maxIdentifierLength);
        if (options.allowedVariables !== undefined && !options.allowedVariables.has(node.name)) {
          throw makeError(ERROR_CODES.UNKNOWN_IDENTIFIER, "Formula references an unknown identifier.", {
            identifier: node.name
          });
        }
        variables.add(node.name);
        break;
      }
      case "UnaryExpression": {
        visit(node.argument, depth + 1);
        break;
      }
      case "BinaryExpression": {
        if (node.operator === "^" && node.right.kind === "NumberLiteral") {
          const exponent = Number(node.right.raw);
          if (!Number.isFinite(exponent) || Math.abs(exponent) > limits.maxExponentMagnitude) {
            throw makeError(ERROR_CODES.EXPONENT_TOO_LARGE, "Power exponent exceeds the configured limit.", {
              exponent,
              maxExponentMagnitude: limits.maxExponentMagnitude
            });
          }
        }
        visit(node.left, depth + 1);
        visit(node.right, depth + 1);
        break;
      }
      case "CallExpression": {
        const arity = FUNCTION_ARITY[node.functionName];
        if (node.args.length < arity.min || (arity.max !== null && node.args.length > arity.max)) {
          throw makeError(ERROR_CODES.INVALID_FUNCTION_ARITY, "Function arity is invalid.", {
            functionName: node.functionName,
            expectedMin: arity.min,
            expectedMax: arity.max,
            actual: node.args.length
          });
        }
        for (const arg of node.args) visit(arg, depth + 1);
        break;
      }
      default: {
        const unreachable: never = node;
        throw makeError(ERROR_CODES.UNSUPPORTED_SYNTAX, "Unsupported AST node.", { node: unreachable });
      }
    }
  };

  visit(ast, 1);
  return {
    nodeCount,
    depth: maxDepth,
    variables: [...variables].sort()
  };
}
