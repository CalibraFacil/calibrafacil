import { ERROR_CODES } from "../errors/codes.js";
import { makeError } from "../errors/errors.js";
import type {
  BinaryOperator,
  FormulaAstNode,
  SafeFunctionName,
  UnaryOperator,
} from "./ast.js";
import { FUNCTION_ARITY, isSafeFunctionName } from "./ast.js";
import type { FormulaLimits } from "./options.js";
import { tokenizeFormula, type Token } from "./tokenizer.js";

class Parser {
  private readonly tokens: readonly Token[];
  private readonly maxDepth: number;
  private index = 0;
  private depth = 0;

  constructor(tokens: readonly Token[], maxDepth: number) {
    this.tokens = tokens;
    this.maxDepth = maxDepth;
  }

  parse(): FormulaAstNode {
    const expression = this.parseAdditive();
    const token = this.current();
    if (token.type !== "eof") {
      throw makeError(
        ERROR_CODES.PARSE_ERROR,
        "Unexpected token after end of expression.",
        {
          token: token.value,
          position: token.position,
        },
      );
    }
    return expression;
  }

  private parseAdditive(): FormulaAstNode {
    let node = this.parseMultiplicative();
    while (
      this.current().type === "operator" &&
      (this.current().value === "+" || this.current().value === "-")
    ) {
      const operator = this.consume().value as BinaryOperator;
      const right = this.parseMultiplicative();
      node = { kind: "BinaryExpression", operator, left: node, right };
    }
    return node;
  }

  private parseMultiplicative(): FormulaAstNode {
    let node = this.parseUnary();
    while (
      this.current().type === "operator" &&
      (this.current().value === "*" || this.current().value === "/")
    ) {
      const operator = this.consume().value as BinaryOperator;
      const right = this.parseUnary();
      node = { kind: "BinaryExpression", operator, left: node, right };
    }
    return node;
  }

  private parseUnary(): FormulaAstNode {
    if (
      this.current().type === "operator" &&
      (this.current().value === "+" || this.current().value === "-")
    ) {
      const operator = this.consume().value as UnaryOperator;
      const argument = this.parseUnary();
      return { kind: "UnaryExpression", operator, argument };
    }
    return this.parsePower();
  }

  private parsePower(): FormulaAstNode {
    const left = this.parsePrimary();
    if (this.current().type === "operator" && this.current().value === "^") {
      this.consume();
      const right = this.parseUnary();
      return { kind: "BinaryExpression", operator: "^", left, right };
    }
    return left;
  }

  private parsePrimary(): FormulaAstNode {
    const token = this.current();

    if (token.type === "number") {
      this.consume();
      return { kind: "NumberLiteral", raw: token.value };
    }

    if (token.type === "identifier") {
      this.consume();
      if (this.current().type === "paren" && this.current().value === "(") {
        const functionName = token.value;
        if (!isSafeFunctionName(functionName)) {
          throw makeError(
            ERROR_CODES.UNKNOWN_FUNCTION,
            "Function is not in the allowed function whitelist.",
            {
              functionName,
              position: token.position,
            },
          );
        }
        return this.parseCall(functionName);
      }
      return { kind: "Variable", name: token.value };
    }

    if (token.type === "paren" && token.value === "(") {
      // Bound parser recursion by maxAstDepth. Parentheses collapse to a depth-1
      // AST, so validateAst's post-parse depth check never constrains nesting;
      // without this guard a deeply parenthesized expression overflows the call
      // stack before any AST limit applies (audit).
      this.depth += 1;
      if (this.depth > this.maxDepth) {
        throw makeError(
          ERROR_CODES.AST_TOO_DEEP,
          "Expression nesting exceeds the configured maximum depth.",
          {
            maxAstDepth: this.maxDepth,
            position: token.position,
          },
        );
      }
      this.consume();
      const expression = this.parseAdditive();
      this.expect("paren", ")");
      this.depth -= 1;
      return expression;
    }

    throw makeError(
      ERROR_CODES.PARSE_ERROR,
      "Expected a number, variable, function call, or parenthesized expression.",
      {
        token: token.value,
        position: token.position,
      },
    );
  }

  private parseCall(functionName: SafeFunctionName): FormulaAstNode {
    this.expect("paren", "(");
    const args: FormulaAstNode[] = [];
    if (!(this.current().type === "paren" && this.current().value === ")")) {
      while (true) {
        args.push(this.parseAdditive());
        if (this.current().type === "comma") {
          this.consume();
          continue;
        }
        break;
      }
    }
    this.expect("paren", ")");
    const arity = FUNCTION_ARITY[functionName];
    if (
      args.length < arity.min ||
      (arity.max !== null && args.length > arity.max)
    ) {
      throw makeError(
        ERROR_CODES.INVALID_FUNCTION_ARITY,
        "Function arity is invalid.",
        {
          functionName,
          expectedMin: arity.min,
          expectedMax: arity.max,
          actual: args.length,
        },
      );
    }
    return { kind: "CallExpression", functionName, args };
  }

  private current(): Token {
    return (
      this.tokens[this.index] ??
      this.tokens[this.tokens.length - 1] ?? {
        type: "eof",
        value: "",
        position: 0,
      }
    );
  }

  private consume(): Token {
    const token = this.current();
    this.index += 1;
    return token;
  }

  private expect(type: Token["type"], value?: string): Token {
    const token = this.current();
    if (token.type !== type || (value !== undefined && token.value !== value)) {
      throw makeError(ERROR_CODES.PARSE_ERROR, "Unexpected token.", {
        expectedType: type,
        expectedValue: value,
        actualType: token.type,
        actualValue: token.value,
        position: token.position,
      });
    }
    return this.consume();
  }
}

export function parseFormula(
  expression: string,
  limits: FormulaLimits,
): FormulaAstNode {
  const tokens = tokenizeFormula(expression, limits);
  return new Parser(tokens, limits.maxAstDepth).parse();
}
