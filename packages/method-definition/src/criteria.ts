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
  leftExpression: string;
  rightExpression: string;
  leftVariables: string[];
  rightVariables: string[];
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

  const leftOriginalExpression = match[1].trim();
  const rightOriginalExpression = match[3].trim();
  const leftRewrite = rewriteAggregatesForCompile(
    leftOriginalExpression,
    allowedVariables,
  );
  const rightRewrite = rewriteAggregatesForCompile(
    rightOriginalExpression,
    allowedVariables,
  );
  const allowedWithSyntheticVariables = [
    ...new Set([
      ...allowedVariables,
      ...leftRewrite.syntheticVariables,
      ...rightRewrite.syntheticVariables,
    ]),
  ].sort();
  const left = engine.compileFormula(leftRewrite.expression, {
    allowedVariables: allowedWithSyntheticVariables,
  });
  const right = engine.compileFormula(rightRewrite.expression, {
    allowedVariables: allowedWithSyntheticVariables,
  });
  const operator = parseCriterionOperator(match[2]);
  const variables = [
    ...new Set(
      [...left.variables, ...right.variables]
        .filter(
          (variable) =>
            !leftRewrite.syntheticVariables.has(variable) &&
            !rightRewrite.syntheticVariables.has(variable),
        )
        .concat([
          ...leftRewrite.consumedVariables,
          ...rightRewrite.consumedVariables,
        ]),
    ),
  ].sort();
  const leftVariables = [
    ...new Set(
      left.variables
        .filter((variable) => !leftRewrite.syntheticVariables.has(variable))
        .concat([...leftRewrite.consumedVariables]),
    ),
  ].sort();
  const rightVariables = [
    ...new Set(
      right.variables
        .filter((variable) => !rightRewrite.syntheticVariables.has(variable))
        .concat([...rightRewrite.consumedVariables]),
    ),
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
    leftExpression: leftOriginalExpression,
    rightExpression: rightOriginalExpression,
    leftVariables,
    rightVariables,
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

function parseCriterionOperator(
  operator: string,
): CompiledCriterion["operator"] {
  switch (operator) {
    case "<=":
    case ">":
    case ">=":
    case "==":
    case "!=":
      return operator;
    default:
      return "<";
  }
}

function rewriteAggregatesForCompile(
  expression: string,
  reservedVariables: readonly string[] = [],
): {
  expression: string;
  consumedVariables: Set<string>;
  syntheticVariables: Set<string>;
} {
  const consumedVariables = new Set<string>();
  const syntheticVariables = new Set<string>();
  const reserved = new Set(reservedVariables);
  let index = 0;
  const rewritten = expression.replace(
    /\b(mean|std|min|max)\s*\(\s*(\[[^\]]*\]|[A-Za-z][A-Za-z0-9_]*)\s*(?:,\s*(\d+))?\s*\)/g,
    (match, _functionName: string, argument: string) => {
      const tokens = [
        ...new Set(argument.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? []),
      ];
      if (tokens.length === 0) return match;
      for (const token of tokens) consumedVariables.add(token);
      let key = `cf_internal_criterion_agg_${index++}`;
      while (reserved.has(key) || syntheticVariables.has(key)) {
        key = `cf_internal_criterion_agg_${index++}`;
      }
      syntheticVariables.add(key);
      return key;
    },
  );

  return {
    expression: rewritten,
    consumedVariables,
    syntheticVariables,
  };
}

export function evaluateCompiledCriterion(
  compiled: CompiledCriterion,
  context: Readonly<Record<string, NumericInput | readonly NumericInput[]>>,
): boolean {
  const leftPrepared = prepareCriterionSide(
    compiled.leftExpression,
    context,
    compiled.leftVariables,
  );
  const rightPrepared = prepareCriterionSide(
    compiled.rightExpression,
    context,
    compiled.rightVariables,
  );
  const left = compiled.left.evaluate(leftPrepared.inputs).value;
  const right = compiled.right.evaluate(rightPrepared.inputs).value;
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

function prepareCriterionSide(
  expression: string,
  context: Readonly<Record<string, NumericInput | readonly NumericInput[]>>,
  variables: readonly string[],
): { inputs: Record<string, NumericInput> } {
  const aggregateInputs: Record<string, NumericInput> = {};
  const consumedVariables = new Set<string>();
  rewriteArrayAggregates(
    expression,
    context,
    aggregateInputs,
    consumedVariables,
  );
  const inputs: Record<string, NumericInput> = {};
  for (const variable of variables) {
    if (consumedVariables.has(variable)) continue;
    const value = context[variable];
    if (
      Array.isArray(value) ||
      (typeof value !== "string" && typeof value !== "number")
    ) {
      throw new Error(`Numeric variable ${variable} is missing`);
    }
    inputs[variable] = value;
  }
  return { inputs: { ...inputs, ...aggregateInputs } };
}

function rewriteArrayAggregates(
  expression: string,
  context: Readonly<Record<string, NumericInput | readonly NumericInput[]>>,
  aggregateInputs: Record<string, NumericInput>,
  consumedVariables: Set<string>,
): void {
  const reserved = new Set(Object.keys(context));
  let index = Object.keys(aggregateInputs).length;
  expression.replace(
    /\b(mean|std|min|max)\s*\(\s*(\[[^\]]*\]|[A-Za-z][A-Za-z0-9_]*)\s*(?:,\s*(\d+))?\s*\)/g,
    (match, functionName: string, argument: string, correction?: string) => {
      const values = resolveInlineNumericArguments(argument, context);
      if (!values.length) return match;

      const value = aggregateValues(functionName, values, correction);
      if (!Number.isFinite(value)) return match;

      let key = `cf_internal_criterion_agg_${index++}`;
      while (reserved.has(key) || key in aggregateInputs) {
        key = `cf_internal_criterion_agg_${index++}`;
      }
      aggregateInputs[key] = value;
      for (const variable of aggregateVariableTokens(argument, context)) {
        consumedVariables.add(variable);
      }
      return key;
    },
  );
}

function aggregateValues(
  functionName: string,
  values: readonly number[],
  correction?: string,
): number {
  switch (functionName) {
    case "mean":
      return values.reduce((sum, item) => sum + item, 0) / values.length;
    case "std":
      return correctedStandardDeviation(values, Number(correction ?? 1));
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    default:
      return Number.NaN;
  }
}

function aggregateVariableTokens(
  argument: string,
  context: Readonly<Record<string, NumericInput | readonly NumericInput[]>>,
): string[] {
  return [
    ...new Set(
      argument
        .match(/[A-Za-z][A-Za-z0-9_]*/g)
        ?.filter((token) => context[token] !== undefined) ?? [],
    ),
  ];
}

function resolveInlineNumericArguments(
  argument: string,
  context: Readonly<Record<string, NumericInput | readonly NumericInput[]>>,
): number[] {
  const trimmed = argument.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .flatMap((item) => resolveInlineNumericToken(item.trim(), context));
  }
  return resolveInlineNumericToken(trimmed, context);
}

function resolveInlineNumericToken(
  token: string,
  context: Readonly<Record<string, NumericInput | readonly NumericInput[]>>,
): number[] {
  if (!token) return [];
  const literal = Number(token);
  if (Number.isFinite(literal)) return [literal];
  const value = context[token];
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
  const scalar = Number(value);
  return Number.isFinite(scalar) ? [scalar] : [];
}

function correctedStandardDeviation(
  values: readonly number[],
  correction: number,
): number {
  const denominator = values.length - correction;
  if (denominator <= 0) return Number.NaN;
  if (allValuesEqual(values)) return 0;

  const mean = values.reduce((sum, item) => sum + item, 0) / values.length;
  const variance =
    values.reduce((sum, item) => sum + (item - mean) ** 2, 0) / denominator;
  return Math.sqrt(variance);
}

function allValuesEqual(values: readonly number[]): boolean {
  return values.every((value) => value === values[0]);
}

export function compareDecimalInputs(
  left: NumericInput,
  right: NumericInput,
): number {
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
