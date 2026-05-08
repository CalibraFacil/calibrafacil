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
  const variables = [
    ...new Set([...left.variables, ...right.variables]),
  ].sort();
  const allowed = new Set(allowedVariables);
  const unknownVariables = variables.filter(
    (variable) => !allowed.has(variable),
  );

  if (unknownVariables.length > 0) {
    throw new Error(
      `Acceptance criterion references unknown variable ${unknownVariables.join(", ")}`,
    );
  }

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
  const left = compiled.left.evaluate(context).value;
  const right = compiled.right.evaluate(context).value;
  const comparison = compareDecimalInputs(left, right);

  switch (compiled.operator) {
    case "<":
      return comparison < 0;
    case "<=":
      return comparison <= 0;
    case ">":
      return comparison > 0;
    case ">=":
      return comparison >= 0;
    case "==":
      return comparison === 0;
    case "!=":
      return comparison !== 0;
  }
}

function compareDecimalInputs(left: NumericInput, right: NumericInput): number {
  const leftDecimal = parseDecimalInput(left);
  const rightDecimal = parseDecimalInput(right);
  const scale = Math.max(leftDecimal.scale, rightDecimal.scale);
  const leftInteger =
    leftDecimal.integer * 10n ** BigInt(scale - leftDecimal.scale);
  const rightInteger =
    rightDecimal.integer * 10n ** BigInt(scale - rightDecimal.scale);
  return leftInteger < rightInteger ? -1 : leftInteger > rightInteger ? 1 : 0;
}

function parseDecimalInput(value: NumericInput): {
  integer: bigint;
  scale: number;
} {
  const text = String(value).trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) {
    throw new Error("Acceptance criterion evaluated to a non-finite value");
  }

  const [coefficient = "", exponentText = "0"] = text.toLowerCase().split("e");
  const exponent = Number(exponentText);
  if (!Number.isInteger(exponent)) {
    throw new Error("Acceptance criterion evaluated to a non-finite value");
  }

  const sign = coefficient.startsWith("-") ? -1n : 1n;
  const unsigned = coefficient.replace(/^[+-]/, "");
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, "") || "0";
  const rawScale = fraction.length - exponent;
  if (rawScale <= 0) {
    return {
      integer: sign * BigInt(digits) * 10n ** BigInt(-rawScale),
      scale: 0,
    };
  }
  return {
    integer: sign * BigInt(digits),
    scale: rawScale,
  };
}
