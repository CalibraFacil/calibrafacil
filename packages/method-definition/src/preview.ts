import { compareDecimalInputs, compileCriterionExpression } from "./criteria";
import { buildMeasurementModelInput } from "./compile";
import { errorDiagnostic } from "./diagnostics";
import { fingerprintJson } from "./fingerprint";
import type {
  CompiledMethod,
  CompiledMeasurementModelDefinition,
  FormulaPreviewResult,
  MethodDiagnostic,
  MethodInput,
  MethodMeasurementModel,
  MethodPreviewResult,
  MethodPreviewScenario,
  NumericInput,
  PreviewInputValue,
  RunMethodPreviewOptions,
} from "./types";

export function runMethodPreview(
  method: CompiledMethod,
  scenario: MethodPreviewScenario,
  options: RunMethodPreviewOptions,
): MethodPreviewResult {
  const diagnostics: MethodDiagnostic[] = [];
  const formulaResults: FormulaPreviewResult[] = [];
  const measurementModelResults: MethodPreviewResult["measurementModelResults"] =
    [];
  const acceptanceCriteriaResults: MethodPreviewResult["acceptanceCriteriaResults"] =
    [];

  const engine = options.engine;
  const context = buildPreviewContext(
    method.inputs,
    scenario.inputs,
    diagnostics,
  );

  for (const formula of method.formulas) {
    try {
      const prepared = prepareFormulaEvaluation(
        formula.expression,
        context,
        formula.variables,
      );
      const result = engine.evaluateFormula(
        prepared.expression,
        prepared.inputs,
      );
      assertFiniteNumericOutput(result.value, `formulas.${formula.key}`);
      context[formula.key] = result.value;
      formulaResults.push({
        key: formula.key,
        value: result.value,
        normalizedFormula: result.normalizedFormula,
        formulaFingerprint: result.formulaFingerprint,
      });
      validateExpected(
        result.value,
        scenario.expected?.formulas?.[formula.key],
        `formulas.${formula.key}`,
        diagnostics,
      );
    } catch (error) {
      diagnostics.push(
        toPreviewDiagnostic(
          error,
          "FORMULA_PREVIEW_FAILED",
          `Formula ${formula.key} failed during preview`,
          `formulas.${formula.key}`,
        ),
      );
    }
  }

  for (const model of method.measurementModels) {
    try {
      const result = engine.evaluateMeasurementModel(
        buildMeasurementModelInput(
          compiledModelToMeasurementModel(model),
          context,
        ),
      );
      assertFiniteNumericOutput(result.value, `measurementModels.${model.key}`);
      context[model.key] = result.value;
      measurementModelResults.push({ key: model.key, result });
      validateExpected(
        result.value,
        scenario.expected?.measurementModels?.[model.key]?.estimate,
        `measurementModels.${model.key}.estimate`,
        diagnostics,
      );
      validateExpected(
        result.combinedStandardUncertainty,
        scenario.expected?.measurementModels?.[model.key]?.standardUncertainty,
        `measurementModels.${model.key}.standardUncertainty`,
        diagnostics,
      );
      validateExpected(
        result.expandedUncertainty,
        scenario.expected?.measurementModels?.[model.key]?.expandedUncertainty,
        `measurementModels.${model.key}.expandedUncertainty`,
        diagnostics,
      );
    } catch (error) {
      diagnostics.push(
        toPreviewDiagnostic(
          error,
          "MEASUREMENT_MODEL_PREVIEW_FAILED",
          `Measurement model ${model.key} failed during preview`,
          `measurementModels.${model.key}`,
        ),
      );
    }
  }

  for (const criterion of method.acceptanceCriteria) {
    try {
      const compiled = compileCriterionExpression(
        criterion,
        engine,
        [...Object.keys(context)].sort(),
        (value) => fingerprintJson(value, "acceptance-criterion"),
      );
      const passed = evaluatePreviewCriterion(compiled, context, engine);
      acceptanceCriteriaResults.push({
        key: criterion.key,
        passed,
        severity: criterion.severity,
        message: criterion.message,
      });
      if (!passed && criterion.severity === "blocking") {
        diagnostics.push(
          errorDiagnostic(
            "BLOCKING_ACCEPTANCE_CRITERION_FAILED",
            criterion.message,
            `acceptanceCriteria.${criterion.key}`,
          ),
        );
      }
    } catch (error) {
      diagnostics.push(
        toPreviewDiagnostic(
          error,
          "ACCEPTANCE_CRITERION_PREVIEW_FAILED",
          `Acceptance criterion ${criterion.key} failed during preview`,
          `acceptanceCriteria.${criterion.key}`,
        ),
      );
    }
  }

  const hasErrors = diagnostics.some((item) => item.severity === "error");
  const passed = scenario.expectFailure ? hasErrors : !hasErrors;

  return {
    scenarioKey: scenario.key,
    passed,
    formulaResults,
    measurementModelResults,
    acceptanceCriteriaResults,
    diagnostics,
  };
}

function buildPreviewContext(
  inputs: readonly MethodInput[],
  values: Record<string, unknown>,
  diagnostics: MethodDiagnostic[],
): Record<string, NumericInput | readonly NumericInput[]> {
  const context: Record<string, NumericInput | readonly NumericInput[]> = {};

  for (const input of inputs) {
    if (
      input.kind === "scalar" &&
      input.metadata?.source === "variable_binding"
    ) {
      const derivedValue = resolveVariableBindingPreviewValue(
        input,
        values,
        diagnostics,
      );
      if (derivedValue !== undefined) {
        context[input.key] = derivedValue;
      }
      continue;
    }

    const value = values[input.key] as PreviewInputValue | undefined;
    if (value === undefined || value === null || value === "") {
      if (input.required) {
        diagnostics.push(
          errorDiagnostic(
            "REQUIRED_PREVIEW_INPUT_MISSING",
            `Required preview input ${input.key} is missing`,
            `inputs.${input.key}`,
          ),
        );
      }
      continue;
    }

    if (input.kind === "scalar") {
      if (typeof value !== "string" && typeof value !== "number") {
        diagnostics.push(
          errorDiagnostic(
            "PREVIEW_INPUT_NOT_NUMERIC",
            `Preview input ${input.key} must be numeric`,
            `inputs.${input.key}`,
          ),
        );
        continue;
      }
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) {
        diagnostics.push(
          errorDiagnostic(
            "PREVIEW_INPUT_NOT_FINITE",
            `Preview input ${input.key} must be finite`,
            `inputs.${input.key}`,
          ),
        );
        continue;
      }
      if (
        input.constraints?.min !== undefined &&
        numericValue < input.constraints.min
      ) {
        diagnostics.push(
          errorDiagnostic(
            "PREVIEW_INPUT_BELOW_MIN",
            `Preview input ${input.key} is below minimum ${input.constraints.min}`,
            `inputs.${input.key}`,
          ),
        );
        continue;
      }
      if (
        input.constraints?.max !== undefined &&
        numericValue > input.constraints.max
      ) {
        diagnostics.push(
          errorDiagnostic(
            "PREVIEW_INPUT_ABOVE_MAX",
            `Preview input ${input.key} is above maximum ${input.constraints.max}`,
            `inputs.${input.key}`,
          ),
        );
        continue;
      }
      if (input.constraints?.integer && !Number.isInteger(numericValue)) {
        diagnostics.push(
          errorDiagnostic(
            "PREVIEW_INPUT_NOT_INTEGER",
            `Preview input ${input.key} must be an integer`,
            `inputs.${input.key}`,
          ),
        );
        continue;
      }
      context[input.key] = value;
    }

    if (input.kind === "select") {
      if (typeof value !== "string") {
        diagnostics.push(
          errorDiagnostic(
            "PREVIEW_SELECT_INPUT_NOT_TEXT",
            `Preview input ${input.key} must be a text option`,
            `inputs.${input.key}`,
          ),
        );
        continue;
      }
      if (!input.options.includes(value)) {
        diagnostics.push(
          errorDiagnostic(
            "PREVIEW_SELECT_INPUT_INVALID_OPTION",
            `Preview input ${input.key} must be one of the configured options`,
            `inputs.${input.key}`,
          ),
        );
        continue;
      }
    }

    if (input.kind === "repeated_observation") {
      if (!Array.isArray(value)) {
        diagnostics.push(
          errorDiagnostic(
            "PREVIEW_INPUT_NOT_ARRAY",
            `Preview input ${input.key} must be an array`,
            `inputs.${input.key}`,
          ),
        );
        continue;
      }
      if (value.length < input.minCount) {
        diagnostics.push(
          errorDiagnostic(
            "PREVIEW_OBSERVATION_COUNT_BELOW_MIN",
            `Preview input ${input.key} must contain at least ${input.minCount} observations`,
            `inputs.${input.key}`,
          ),
        );
        continue;
      }
      if (input.maxCount !== undefined && value.length > input.maxCount) {
        diagnostics.push(
          errorDiagnostic(
            "PREVIEW_OBSERVATION_COUNT_ABOVE_MAX",
            `Preview input ${input.key} must contain at most ${input.maxCount} observations`,
            `inputs.${input.key}`,
          ),
        );
        continue;
      }
      const observations: NumericInput[] = [];
      let invalid = false;
      for (const [index, item] of value.entries()) {
        if (typeof item !== "string" && typeof item !== "number") {
          diagnostics.push(
            errorDiagnostic(
              "PREVIEW_OBSERVATION_NOT_NUMERIC",
              `Preview observation ${input.key}[${index}] must be numeric`,
              `inputs.${input.key}.${index}`,
            ),
          );
          invalid = true;
          continue;
        }
        if (!Number.isFinite(Number(item))) {
          diagnostics.push(
            errorDiagnostic(
              "PREVIEW_OBSERVATION_NOT_FINITE",
              `Preview observation ${input.key}[${index}] must be finite`,
              `inputs.${input.key}.${index}`,
            ),
          );
          invalid = true;
          continue;
        }
        observations.push(item);
      }
      if (invalid) continue;
      context[input.key] = observations;
    }

    if (input.kind === "table") {
      if (!Array.isArray(value)) {
        diagnostics.push(
          errorDiagnostic(
            "PREVIEW_TABLE_NOT_ARRAY",
            `Preview input ${input.key} must be an array of rows`,
            `inputs.${input.key}`,
          ),
        );
        continue;
      }
      const minRows = Math.max(input.minRows ?? 0, input.required ? 1 : 0);
      if (value.length < minRows) {
        diagnostics.push(
          errorDiagnostic(
            "PREVIEW_TABLE_ROW_COUNT_BELOW_MIN",
            `Preview table ${input.key} must contain at least ${minRows} rows`,
            `inputs.${input.key}`,
          ),
        );
        continue;
      }
      if (input.maxRows !== undefined && value.length > input.maxRows) {
        diagnostics.push(
          errorDiagnostic(
            "PREVIEW_TABLE_ROW_COUNT_ABOVE_MAX",
            `Preview table ${input.key} must contain at most ${input.maxRows} rows`,
            `inputs.${input.key}`,
          ),
        );
        continue;
      }

      for (const [rowIndex, row] of value.entries()) {
        if (!row || typeof row !== "object" || Array.isArray(row)) {
          diagnostics.push(
            errorDiagnostic(
              "PREVIEW_TABLE_ROW_INVALID",
              `Preview table ${input.key} row ${rowIndex} must be an object`,
              `inputs.${input.key}.${rowIndex}`,
            ),
          );
          continue;
        }
        const record = row as Record<string, unknown>;
        for (const column of input.columns) {
          const cell = record[column.key];
          if (cell === undefined || cell === null || cell === "") {
            if (column.required) {
              diagnostics.push(
                errorDiagnostic(
                  "PREVIEW_TABLE_CELL_MISSING",
                  `Preview table ${input.key} row ${rowIndex} is missing required column ${column.key}`,
                  `inputs.${input.key}.${rowIndex}.${column.key}`,
                ),
              );
            }
            continue;
          }
          if (column.type === "number") {
            if (
              (typeof cell !== "string" && typeof cell !== "number") ||
              !Number.isFinite(Number(cell))
            ) {
              diagnostics.push(
                errorDiagnostic(
                  "PREVIEW_TABLE_CELL_NOT_NUMERIC",
                  `Preview table ${input.key} row ${rowIndex} column ${column.key} must be numeric`,
                  `inputs.${input.key}.${rowIndex}.${column.key}`,
                ),
              );
            }
          }
        }
      }
    }
  }

  return context;
}

function resolveVariableBindingPreviewValue(
  input: MethodInput & { kind: "scalar" },
  values: Record<string, unknown>,
  diagnostics: MethodDiagnostic[],
): NumericInput | readonly NumericInput[] | undefined {
  const metadata = input.metadata ?? {};
  switch (metadata.bindingSource) {
    case "data_field":
      return toNumericInput(values[String(metadata.fieldKey)]);
    case "table_column":
      return tableColumnNumbers(
        String(metadata.fieldKey),
        String(metadata.columnKey),
        values,
        diagnostics,
      );
    case "table_statistic":
      return tableStatistic(
        String(metadata.fieldKey),
        String(metadata.columnKey),
        String(metadata.statistic),
        values,
        diagnostics,
      );
    case "environment":
      return environmentValue(String(metadata.field), values);
    case "standard":
      return standardValue(metadata, values);
    default:
      return undefined;
  }
}

function tableStatistic(
  fieldKey: string,
  columnKey: string,
  statistic: string,
  values: Record<string, unknown>,
  diagnostics: MethodDiagnostic[],
): NumericInput | undefined {
  const numbers = tableColumnNumbers(fieldKey, columnKey, values, diagnostics);
  if (!numbers.length && statistic !== "count") return undefined;

  switch (statistic) {
    case "count":
      return numbers.length;
    case "mean":
      return sum(numbers) / numbers.length;
    case "sample_stddev":
      return numbers.length >= 2 ? sampleStandardDeviation(numbers) : undefined;
    case "min":
      return Math.min(...numbers);
    case "max":
      return Math.max(...numbers);
    default:
      return undefined;
  }
}

function tableColumnNumbers(
  fieldKey: string,
  columnKey: string,
  values: Record<string, unknown>,
  diagnostics: MethodDiagnostic[],
): readonly number[] {
  const rows = values[fieldKey];
  if (!Array.isArray(rows)) return [];

  const numbers: number[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    const path = `inputs.${fieldKey}.${rowIndex}.${columnKey}`;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      diagnostics.push(
        errorDiagnostic(
          "PREVIEW_TABLE_ROW_INVALID",
          `Preview table ${fieldKey} row ${rowIndex} must be an object`,
          `inputs.${fieldKey}.${rowIndex}`,
        ),
      );
      continue;
    }

    const cell = (row as Record<string, unknown>)[columnKey];
    if (cell === undefined || cell === null || cell === "") {
      diagnostics.push(
        errorDiagnostic(
          "PREVIEW_TABLE_BINDING_CELL_MISSING",
          `Preview table ${fieldKey} row ${rowIndex} is missing bound column ${columnKey}`,
          path,
        ),
      );
      continue;
    }

    const number = toFiniteNumber(cell);
    if (number === null) {
      diagnostics.push(
        errorDiagnostic(
          "PREVIEW_TABLE_BINDING_CELL_NOT_NUMERIC",
          `Preview table ${fieldKey} row ${rowIndex} bound column ${columnKey} must be numeric`,
          path,
        ),
      );
      continue;
    }
    numbers.push(number);
  }
  return numbers;
}

function environmentValue(
  field: string,
  values: Record<string, unknown>,
): NumericInput | undefined {
  const environment = values.environment;
  if (
    !environment ||
    typeof environment !== "object" ||
    Array.isArray(environment)
  ) {
    return undefined;
  }
  return toNumericInput((environment as Record<string, unknown>)[field]);
}

function standardValue(
  metadata: Record<string, string | number | boolean | null>,
  values: Record<string, unknown>,
): NumericInput | undefined {
  const standards = values.standards;
  if (!Array.isArray(standards)) return undefined;

  const standard =
    typeof metadata.standardId === "number"
      ? standards.find(
          (item) =>
            item &&
            typeof item === "object" &&
            !Array.isArray(item) &&
            (item as Record<string, unknown>).id === metadata.standardId,
        )
      : standards[0];

  if (!standard || typeof standard !== "object" || Array.isArray(standard)) {
    return undefined;
  }

  const record = standard as Record<string, unknown>;
  const valueKey =
    typeof metadata.valueKey === "string" ? metadata.valueKey : "";
  if (valueKey === "uncertainty") return toNumericInput(record.uncertainty);
  if (valueKey === "coverageFactor" || valueKey === "k") {
    return toNumericInput(record.coverageFactor);
  }
  if (valueKey === "drift") return toNumericInput(record.drift);

  const certifiedValues = record.certifiedValues;
  if (!Array.isArray(certifiedValues)) return undefined;
  const certifiedValue = certifiedValues.find(
    (item) =>
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      String((item as Record<string, unknown>).nominal).replace(/\s+/g, "") ===
        valueKey,
  );
  if (certifiedValue && typeof certifiedValue === "object") {
    return toNumericInput((certifiedValue as Record<string, unknown>).value);
  }

  const uncertaintyKey = valueKey.endsWith("_u") ? valueKey.slice(0, -2) : null;
  if (!uncertaintyKey) return undefined;
  const uncertaintyValue = certifiedValues.find(
    (item) =>
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      String((item as Record<string, unknown>).nominal).replace(/\s+/g, "") ===
        uncertaintyKey,
  );
  return uncertaintyValue && typeof uncertaintyValue === "object"
    ? toNumericInput((uncertaintyValue as Record<string, unknown>).uncertainty)
    : undefined;
}

function toNumericInput(value: unknown): NumericInput | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  return Number.isFinite(Number(value)) ? value : undefined;
}

function toFiniteNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function sum(values: readonly number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

function sampleStandardDeviation(values: readonly number[]): number {
  const mean = sum(values) / values.length;
  const variance =
    values.reduce((acc, value) => acc + (value - mean) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

function evaluatePreviewCriterion(
  compiled: ReturnType<typeof compileCriterionExpression>,
  context: Record<string, NumericInput | readonly NumericInput[]>,
  engine: RunMethodPreviewOptions["engine"],
): boolean {
  const leftPrepared = prepareFormulaEvaluation(
    compiled.leftExpression,
    context,
    compiled.left.variables,
  );
  const rightPrepared = prepareFormulaEvaluation(
    compiled.rightExpression,
    context,
    compiled.right.variables,
  );
  const left = engine.evaluateFormula(
    leftPrepared.expression,
    leftPrepared.inputs,
  ).value;
  const right = engine.evaluateFormula(
    rightPrepared.expression,
    rightPrepared.inputs,
  ).value;
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

function prepareFormulaEvaluation(
  expression: string,
  context: Record<string, NumericInput | readonly NumericInput[]>,
  variables: readonly string[],
): { expression: string; inputs: Record<string, NumericInput> } {
  const inputs = pickNumericContext(context, variables, { allowArrays: true });
  const aggregateInputs: Record<string, NumericInput> = {};
  const rewrittenExpression = rewriteArrayAggregates(
    expression,
    context,
    aggregateInputs,
  );
  return {
    expression: rewrittenExpression,
    inputs: { ...inputs, ...aggregateInputs },
  };
}

function rewriteArrayAggregates(
  expression: string,
  context: Record<string, NumericInput | readonly NumericInput[]>,
  aggregateInputs: Record<string, NumericInput>,
): string {
  let index = Object.keys(aggregateInputs).length;
  return expression.replace(
    /\b(mean|std)\s*\(\s*(\[[^\]]*\]|[A-Za-z][A-Za-z0-9_]*)\s*(?:,\s*(\d+))?\s*\)/g,
    (match, functionName: string, argument: string, correction?: string) => {
      const values = resolveInlineNumericArguments(argument, context);
      if (!values.length) return match;

      const value =
        functionName === "mean"
          ? sum(values) / values.length
          : correctedStandardDeviation(values, Number(correction ?? 1));
      if (!Number.isFinite(value)) return match;

      const key = `preview_${index++}`;
      aggregateInputs[key] = value;
      return key;
    },
  );
}

function resolveInlineNumericArguments(
  argument: string,
  context: Record<string, NumericInput | readonly NumericInput[]>,
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
  context: Record<string, NumericInput | readonly NumericInput[]>,
): number[] {
  if (!token) return [];
  const literal = toFiniteNumber(token);
  if (literal !== null) return [literal];
  const value = context[token];
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
  const scalar = toFiniteNumber(value);
  return scalar === null ? [] : [scalar];
}

function correctedStandardDeviation(
  values: readonly number[],
  correction: number,
): number {
  const denominator = values.length - correction;
  if (denominator <= 0) return Number.NaN;

  const mean = sum(values) / values.length;
  const variance =
    values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / denominator;
  return Math.sqrt(variance);
}

function pickNumericContext(
  context: Record<string, NumericInput | readonly NumericInput[]>,
  variables: readonly string[],
  options: { allowArrays?: boolean } = {},
): Record<string, NumericInput> {
  const picked: Record<string, NumericInput> = {};
  for (const variable of variables) {
    const value = context[variable];
    if (Array.isArray(value)) {
      if (options.allowArrays) continue;
      throw new Error(`Numeric variable ${variable} is missing`);
    }
    if (value === undefined) {
      throw new Error(`Numeric variable ${variable} is missing`);
    }
    if (typeof value !== "string" && typeof value !== "number") {
      throw new Error(`Numeric variable ${variable} is not scalar`);
    }
    picked[variable] = value;
  }
  return picked;
}

function assertFiniteNumericOutput(value: string | number, path: string): void {
  if (!Number.isFinite(Number(value))) {
    throw new Error(`${path} produced a non-finite result`);
  }
}

function validateExpected(
  actual: string | number,
  expected: string | number | undefined,
  path: string,
  diagnostics: MethodDiagnostic[],
): void {
  if (expected === undefined) return;
  const actualNumber = Number(actual);
  const expectedNumber = Number(expected);
  if (!Number.isFinite(actualNumber) || !Number.isFinite(expectedNumber)) {
    diagnostics.push(
      errorDiagnostic(
        "PREVIEW_EXPECTED_VALUE_INVALID",
        `Preview expected value at ${path} is not finite`,
        path,
      ),
    );
    return;
  }
  const tolerance = Math.max(1e-9, Math.abs(expectedNumber) * 1e-9);
  if (Math.abs(actualNumber - expectedNumber) > tolerance) {
    diagnostics.push(
      errorDiagnostic(
        "PREVIEW_EXPECTED_VALUE_MISMATCH",
        `Preview expected ${expectedNumber} but got ${actualNumber}`,
        path,
      ),
    );
  }
}

function compiledModelToMeasurementModel(
  model: CompiledMeasurementModelDefinition,
): MethodMeasurementModel {
  return {
    key: model.key,
    label: model.key,
    measurand: model.key,
    expression: model.expression,
    quantities: model.quantities,
    correlations: model.correlations,
    covariances: model.covariances,
    coverageProbability: model.coverageProbability,
    coverageFactor: model.coverageFactor,
    options: model.options,
  };
}

function toPreviewDiagnostic(
  error: unknown,
  code: string,
  fallbackMessage: string,
  path: string,
): MethodDiagnostic {
  if (isCalculationEngineErrorLike(error)) {
    return errorDiagnostic(
      code,
      error.message,
      typeof error.details?.path === "string" ? error.details.path : path,
      { engineCode: error.code },
    );
  }
  return errorDiagnostic(
    code,
    error instanceof Error ? error.message : fallbackMessage,
    path,
  );
}

function isCalculationEngineErrorLike(error: unknown): error is {
  code: string;
  message: string;
  details?: { path?: unknown };
} {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error
  );
}
