export interface FormulaLimits {
  readonly maxExpressionLength: number;
  readonly maxAstDepth: number;
  readonly maxAstNodes: number;
  readonly maxIdentifierLength: number;
  readonly maxNumberLiteralLength: number;
  readonly maxExponentMagnitude: number;
  readonly maxSignificantDigits?: number;
}

// maxAstDepth is the depth of the tree, and a chain of n operators of one
// precedence (a + b + c + …) is a tree n + 1 deep: at 256 a plain sum reaches
// the node limit first (255 operators are 511 nodes). At 64, the default up to
// 0.5.0, a sum of 65 terms was refused as too deep with 129 of its 512 nodes.
export const DEFAULT_FORMULA_LIMITS: FormulaLimits = {
  maxExpressionLength: 2000,
  maxAstDepth: 256,
  maxAstNodes: 512,
  maxIdentifierLength: 96,
  maxNumberLiteralLength: 128,
  maxExponentMagnitude: 12
};

export function mergeFormulaLimits(overrides: Partial<FormulaLimits> = {}): FormulaLimits {
  return {
    maxExpressionLength: overrides.maxExpressionLength ?? DEFAULT_FORMULA_LIMITS.maxExpressionLength,
    maxAstDepth: overrides.maxAstDepth ?? DEFAULT_FORMULA_LIMITS.maxAstDepth,
    maxAstNodes: overrides.maxAstNodes ?? DEFAULT_FORMULA_LIMITS.maxAstNodes,
    maxIdentifierLength: overrides.maxIdentifierLength ?? DEFAULT_FORMULA_LIMITS.maxIdentifierLength,
    maxNumberLiteralLength: overrides.maxNumberLiteralLength ?? DEFAULT_FORMULA_LIMITS.maxNumberLiteralLength,
    maxExponentMagnitude: overrides.maxExponentMagnitude ?? DEFAULT_FORMULA_LIMITS.maxExponentMagnitude,
    // Optional, and kept when given: dropping it here made parseFormula accept a
    // literal that compileFormula then refused (review).
    ...(overrides.maxSignificantDigits === undefined ? {} : { maxSignificantDigits: overrides.maxSignificantDigits })
  };
}
