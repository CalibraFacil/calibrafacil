export type UnaryOperator = "+" | "-";
export type BinaryOperator = "+" | "-" | "*" | "/" | "^";

export interface AstBase {
  readonly kind: string;
}

export interface NumberLiteralNode extends AstBase {
  readonly kind: "NumberLiteral";
  readonly raw: string;
}

export interface VariableNode extends AstBase {
  readonly kind: "Variable";
  readonly name: string;
}

export interface UnaryExpressionNode extends AstBase {
  readonly kind: "UnaryExpression";
  readonly operator: UnaryOperator;
  readonly argument: FormulaAstNode;
}

export interface BinaryExpressionNode extends AstBase {
  readonly kind: "BinaryExpression";
  readonly operator: BinaryOperator;
  readonly left: FormulaAstNode;
  readonly right: FormulaAstNode;
}

export interface CallExpressionNode extends AstBase {
  readonly kind: "CallExpression";
  readonly functionName: SafeFunctionName;
  readonly args: readonly FormulaAstNode[];
}

export type FormulaAstNode =
  | NumberLiteralNode
  | VariableNode
  | UnaryExpressionNode
  | BinaryExpressionNode
  | CallExpressionNode;

export const SAFE_FUNCTIONS = [
  "sqrt",
  "abs",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "log",
  "log10",
  "exp",
  "min",
  "max",
  "floor",
  "ceil",
  "round",
  "student_t_inverse_2t",
  "if_zero"
] as const;

export type SafeFunctionName = typeof SAFE_FUNCTIONS[number];

export const SAFE_FUNCTION_SET: ReadonlySet<string> = new Set(SAFE_FUNCTIONS);

export const FUNCTION_ARITY: Readonly<Record<SafeFunctionName, { readonly min: number; readonly max: number | null }>> = {
  sqrt: { min: 1, max: 1 },
  abs: { min: 1, max: 1 },
  sin: { min: 1, max: 1 },
  cos: { min: 1, max: 1 },
  tan: { min: 1, max: 1 },
  asin: { min: 1, max: 1 },
  acos: { min: 1, max: 1 },
  atan: { min: 1, max: 1 },
  log: { min: 1, max: 1 },
  log10: { min: 1, max: 1 },
  exp: { min: 1, max: 1 },
  min: { min: 1, max: null },
  max: { min: 1, max: null },
  floor: { min: 1, max: 1 },
  ceil: { min: 1, max: 1 },
  round: { min: 1, max: 1 },
  student_t_inverse_2t: { min: 2, max: 2 },
  if_zero: { min: 3, max: 3 }
};

export function isSafeFunctionName(value: string): value is SafeFunctionName {
  return SAFE_FUNCTION_SET.has(value);
}
