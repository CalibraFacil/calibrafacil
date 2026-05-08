import type {
  CalculationEngineLike,
  CompiledFormulaLike,
  MethodAcceptanceCriterion,
  NumericInput,
} from "./types";

const COMPARATOR_PATTERN = /^\s*(.+?)\s*(<=|>=|==|!=|<|>)\s*(.+?)\s*$/;

export type CompiledCriterion = {
  criterion: MethodAcceptanceCriterion;
  left: CompiledFormulaLike;
  right: CompiledFormulaLike;
  operator: "<" | "<=" | ">" | ">=" | "==" | "!=";
  normalizedFormula: string;
  variables: string[];
  criterionFingerprint: string;
};

export function compileCriterionExpression(
  criterion: MethodAcceptanceCriterion,
  engine: CalculationEngineLike,
  allowedVariables: readonly string[],
  fingerprint: (value: unknown) => string,
): CompiledCriterion {
  const match = criterion.expression.match(COMPARATOR_PATTERN);
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error(
      "Acceptance criterion expression must be a boolean comparison",
    );
  }

  const left = engine.compileFormula(match[1].trim(), { allowedVariables });
  const right = engine.compileFormula(match[3].trim(), { allowedVariables });
  const operator = match[2] as CompiledCriterion["operator"];
  const variables = [...new Set([...left.variables, ...right.variables])].sort();
  const normalizedFormula = `${left.normalizedFormula} ${operator} ${right.normalizedFormula}`;

  return {
    criterion,
    left,
    right,
    operator,
    normalizedFormula,
    variables,
    criterionFingerprint: fingerprint({
      kind: "acceptance_criterion",
      expression: criterion.expression,
      normalizedFormula,
      operator,
      variables,
    }),
  };
}

export function evaluateCompiledCriterion(
  compiled: CompiledCriterion,
  context: Readonly<Record<string, NumericInput>>,
): boolean {
  const left = Number(compiled.left.evaluate(context).value);
  const right = Number(compiled.right.evaluate(context).value);
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    throw new Error("Acceptance criterion evaluated to a non-finite value");
  }

  switch (compiled.operator) {
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    case "==":
      return Object.is(left, right) || left === right;
    case "!=":
      return left !== right;
  }
}
