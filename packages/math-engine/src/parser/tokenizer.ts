import { ERROR_CODES } from "../errors/codes.js";
import { makeError } from "../errors/errors.js";
import { assertSafeIdentifier } from "./identifiers.js";
import { validateNumericString } from "../numeric/validation.js";
import type { FormulaLimits } from "./options.js";

export type TokenType = "number" | "identifier" | "operator" | "paren" | "comma" | "eof";

export interface Token {
  readonly type: TokenType;
  readonly value: string;
  readonly position: number;
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

function isIdentifierStart(char: string): boolean {
  return (char >= "A" && char <= "Z") || (char >= "a" && char <= "z") || char === "_";
}

function isIdentifierPart(char: string): boolean {
  return isIdentifierStart(char) || isDigit(char);
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

export function tokenizeFormula(expression: string, limits: FormulaLimits): readonly Token[] {
  if (expression.length > limits.maxExpressionLength) {
    throw makeError(ERROR_CODES.EXPRESSION_TOO_LONG, "Formula exceeds the configured expression length limit.", {
      maxExpressionLength: limits.maxExpressionLength,
      actualLength: expression.length
    });
  }

  const tokens: Token[] = [];
  let index = 0;

  while (index < expression.length) {
    const char = expression[index] ?? "";

    if (isWhitespace(char)) {
      index += 1;
      continue;
    }

    if (isDigit(char) || (char === "." && isDigit(expression[index + 1] ?? ""))) {
      const start = index;
      if (char === ".") {
        index += 1;
      }
      while (isDigit(expression[index] ?? "")) index += 1;
      if ((expression[index] ?? "") === ".") {
        index += 1;
        while (isDigit(expression[index] ?? "")) index += 1;
      }
      const exponentMarker = expression[index] ?? "";
      if (exponentMarker === "e" || exponentMarker === "E") {
        const exponentStart = index;
        index += 1;
        const sign = expression[index] ?? "";
        if (sign === "+" || sign === "-") index += 1;
        const digitsStart = index;
        while (isDigit(expression[index] ?? "")) index += 1;
        if (digitsStart === index) {
          throw makeError(ERROR_CODES.INVALID_TOKEN, "Malformed numeric exponent.", { position: exponentStart });
        }
      }
      const value = expression.slice(start, index);
      if (value.length > limits.maxNumberLiteralLength) {
        throw makeError(ERROR_CODES.NUMBER_LITERAL_TOO_LONG, "Number literal exceeds the configured length limit.", {
          literal: value,
          maxNumberLiteralLength: limits.maxNumberLiteralLength
        });
      }
      validateNumericString(value, {
        maxExponentMagnitude: limits.maxExponentMagnitude,
        maxInputLength: limits.maxNumberLiteralLength,
        maxSignificantDigits: limits.maxNumberLiteralLength,
        label: "number literal"
      });
      tokens.push({ type: "number", value, position: start });
      continue;
    }

    if (isIdentifierStart(char)) {
      const start = index;
      index += 1;
      while (isIdentifierPart(expression[index] ?? "")) index += 1;
      const identifier = expression.slice(start, index);
      assertSafeIdentifier(identifier, limits.maxIdentifierLength);
      tokens.push({ type: "identifier", value: identifier, position: start });
      continue;
    }

    if (char === "+" || char === "-" || char === "*" || char === "/" || char === "^") {
      tokens.push({ type: "operator", value: char, position: index });
      index += 1;
      continue;
    }

    if (char === "(" || char === ")") {
      tokens.push({ type: "paren", value: char, position: index });
      index += 1;
      continue;
    }

    if (char === ",") {
      tokens.push({ type: "comma", value: char, position: index });
      index += 1;
      continue;
    }

    throw makeError(ERROR_CODES.INVALID_TOKEN, "Formula contains an unsupported token.", { token: char, position: index });
  }

  tokens.push({ type: "eof", value: "", position: expression.length });
  return tokens;
}
