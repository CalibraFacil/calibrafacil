export interface FormulaLimits {
  readonly maxExpressionLength: number;
  readonly maxAstDepth: number;
  readonly maxAstNodes: number;
  readonly maxIdentifierLength: number;
  readonly maxNumberLiteralLength: number;
  readonly maxExponentMagnitude: number;
  readonly maxSignificantDigits?: number;
}

export const DEFAULT_FORMULA_LIMITS: FormulaLimits = {
  maxExpressionLength: 2000,
  maxAstDepth: 64,
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
    maxExponentMagnitude: overrides.maxExponentMagnitude ?? DEFAULT_FORMULA_LIMITS.maxExponentMagnitude
  };
}
