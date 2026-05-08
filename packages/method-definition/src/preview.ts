import {
  compileCriterionExpression,
  evaluateCompiledCriterion,
} from "./criteria";
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
  const context = buildPreviewContext(method.inputs, scenario.inputs, diagnostics);

  for (const formula of method.formulas) {
    try {
      const inputs = pickNumericContext(context, formula.variables);
      const result = engine.evaluateFormula(formula.expression, inputs);
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
      const passed = evaluateCompiledCriterion(compiled, pickNumericContext(context, compiled.variables));
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
      context[input.key] = value as readonly NumericInput[];
    }
  }

  return context;
}

function pickNumericContext(
  context: Record<string, NumericInput | readonly NumericInput[]>,
  variables: readonly string[],
): Record<string, NumericInput> {
  const picked: Record<string, NumericInput> = {};
  for (const variable of variables) {
    const value = context[variable];
    if (Array.isArray(value) || value === undefined) {
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

function isCalculationEngineErrorLike(
  error: unknown,
): error is {
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
