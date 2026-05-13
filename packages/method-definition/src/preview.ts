import { compareDecimalInputs, compileCriterionExpression } from "./criteria";
import { buildMeasurementModelInput } from "./compile";
import { errorDiagnostic } from "./diagnostics";
import { fingerprintJson } from "./fingerprint";
import type {
  CalibrationPhase,
  CalibrationPhaseSnapshot,
  CompiledFormulaDefinition,
  CompiledMethod,
  CompiledMeasurementModelDefinition,
  FormulaPreviewResult,
  MethodDiagnostic,
  MethodInput,
  MethodMeasurementModel,
  MeasurementModelResultLike,
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
  const calibrationPhases =
    options.calibrationPhases ?? scenario.calibrationPhases;
  const context = buildPreviewContext(
    method.inputs,
    scenario.inputs,
    diagnostics,
    calibrationPhases,
  );

  for (const formula of method.formulas) {
    if (!isPhaseActive(formula.metadata, calibrationPhases)) continue;
    try {
      if (formula.scope?.kind === "table_row") {
        const values = evaluateTableRowFormula(
          formula,
          method.inputs,
          method.formulas,
          scenario.inputs,
          context,
          engine,
          diagnostics,
        );
        context[formula.key] = values;
        formulaResults.push({
          key: formula.key,
          value: values,
          normalizedFormula: formula.normalizedFormula,
          formulaFingerprint: formula.formulaFingerprint,
        });
        validateExpected(
          values,
          scenario.expected?.formulas?.[formula.key],
          `formulas.${formula.key}`,
          diagnostics,
        );
        continue;
      }

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
        normalizedFormula: formula.normalizedFormula,
        formulaFingerprint: formula.formulaFingerprint,
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
    if (!isPhaseActive(model.metadata, calibrationPhases)) continue;
    try {
      if (model.scope?.kind === "table_row") {
        const results = evaluateTableRowMeasurementModel(
          model,
          method.inputs,
          method.formulas,
          scenario.inputs,
          context,
          engine,
          diagnostics,
        );
        context[model.key] = results.map((result) => result.value);
        measurementModelResults.push({ key: model.key, result: results });
        validateExpected(
          results.map((result) => result.value),
          scenario.expected?.measurementModels?.[model.key]?.estimate,
          `measurementModels.${model.key}.estimate`,
          diagnostics,
        );
        validateExpected(
          results.map((result) => result.combinedStandardUncertainty),
          scenario.expected?.measurementModels?.[model.key]
            ?.standardUncertainty,
          `measurementModels.${model.key}.standardUncertainty`,
          diagnostics,
        );
        validateExpected(
          results.map((result) => result.expandedUncertainty),
          scenario.expected?.measurementModels?.[model.key]
            ?.expandedUncertainty,
          `measurementModels.${model.key}.expandedUncertainty`,
          diagnostics,
        );
        continue;
      }

      const result = engine.evaluateMeasurementModel(
        buildMeasurementModelInput(
          compiledModelToMeasurementModel(model),
          context,
          { engine },
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
    if (!isPhaseActive(criterion.metadata, calibrationPhases)) continue;
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

function evaluateTableRowFormula(
  formula: CompiledFormulaDefinition,
  inputs: readonly MethodInput[],
  formulas: readonly CompiledFormulaDefinition[],
  values: Record<string, unknown>,
  context: Record<string, NumericInput | readonly NumericInput[]>,
  engine: RunMethodPreviewOptions["engine"],
  diagnostics: MethodDiagnostic[],
): NumericInput[] {
  const tableKey =
    formula.scope?.kind === "table_row" ? formula.scope.tableKey : "";
  const tableInput = inputs.find(
    (input) => input.kind === "table" && input.key === tableKey,
  );
  const rows = values[tableKey];
  if (!tableInput || tableInput.kind !== "table") {
    diagnostics.push(
      errorDiagnostic(
        "ROW_FORMULA_TABLE_UNKNOWN",
        `Row formula ${formula.key} references unknown table ${tableKey}`,
        `formulas.${formula.key}.scope.tableKey`,
      ),
    );
    return [];
  }
  if (!Array.isArray(rows)) {
    diagnostics.push(
      errorDiagnostic(
        "ROW_FORMULA_TABLE_INPUT_MISSING",
        `Row formula ${formula.key} requires table input ${tableKey}`,
        `inputs.${tableKey}`,
      ),
    );
    return [];
  }

  const numericColumns = tableInput.columns.filter(
    (column) => column.type === "number",
  );
  const outputs: NumericInput[] = [];
  let failed = false;

  for (const [rowIndex, row] of rows.entries()) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      failed = true;
      diagnostics.push(
        errorDiagnostic(
          "ROW_FORMULA_TABLE_ROW_INVALID",
          `Row formula ${formula.key} requires row ${rowIndex} from table ${tableKey} to be an object`,
          `inputs.${tableKey}.${rowIndex}`,
        ),
      );
      continue;
    }

    const rowContext: Record<string, NumericInput | readonly NumericInput[]> = {
      ...context,
    };
    for (const variable of formula.variables) {
      const value = context[variable];
      if (Array.isArray(value) && value[rowIndex] !== undefined) {
        const sourceTableKey = rowAlignedArrayTableKey(
          variable,
          inputs,
          formulas,
        );
        const requiresRowAlignedValue =
          !isVariableUsedOnlyInWholeArrayAggregate(
            formula.expression,
            variable,
          );
        if (sourceTableKey === tableKey && requiresRowAlignedValue) {
          rowContext[variable] = value[rowIndex];
        } else if (sourceTableKey && requiresRowAlignedValue) {
          failed = true;
          diagnostics.push(
            errorDiagnostic(
              "ROW_FORMULA_CROSS_TABLE_ARRAY",
              `Row formula ${formula.key} cannot use array variable ${variable} from table ${sourceTableKey} while evaluating table ${tableKey}`,
              `formulas.${formula.key}.${rowIndex}`,
            ),
          );
        }
      }
    }

    const record = row as Record<string, unknown>;
    for (const column of numericColumns) {
      const value = record[column.key];
      if (value === undefined || value === null || value === "") continue;
      if (typeof value !== "string" && typeof value !== "number") continue;
      if (
        formula.variables.includes(column.key) &&
        context[column.key] !== undefined
      ) {
        continue;
      }
      rowContext[column.key] = value;
    }

    try {
      const prepared = prepareFormulaEvaluation(
        formula.expression,
        rowContext,
        formula.variables,
        { aggregateContext: context },
      );
      const result = engine.evaluateFormula(
        prepared.expression,
        prepared.inputs,
      );
      assertFiniteNumericOutput(
        result.value,
        `formulas.${formula.key}.${rowIndex}`,
      );
      outputs[rowIndex] = result.value;
    } catch (error) {
      failed = true;
      diagnostics.push(
        toPreviewDiagnostic(
          error,
          "ROW_FORMULA_PREVIEW_FAILED",
          `Formula ${formula.key} failed during preview for row ${rowIndex}`,
          `formulas.${formula.key}.${rowIndex}`,
        ),
      );
    }
  }

  return failed ? [] : outputs;
}

function evaluateTableRowMeasurementModel(
  model: CompiledMeasurementModelDefinition,
  inputs: readonly MethodInput[],
  formulas: readonly CompiledFormulaDefinition[],
  values: Record<string, unknown>,
  context: Record<string, NumericInput | readonly NumericInput[]>,
  engine: RunMethodPreviewOptions["engine"],
  diagnostics: MethodDiagnostic[],
): MeasurementModelResultLike[] {
  const tableKey =
    model.scope?.kind === "table_row" ? model.scope.tableKey : "";
  const tableInput = inputs.find(
    (input) => input.kind === "table" && input.key === tableKey,
  );
  const rows = values[tableKey];
  if (!tableInput || tableInput.kind !== "table") {
    diagnostics.push(
      errorDiagnostic(
        "ROW_MEASUREMENT_MODEL_TABLE_UNKNOWN",
        `Measurement model ${model.key} references unknown table ${tableKey}`,
        `measurementModels.${model.key}.scope.tableKey`,
      ),
    );
    return [];
  }
  if (!Array.isArray(rows)) {
    diagnostics.push(
      errorDiagnostic(
        "ROW_MEASUREMENT_MODEL_TABLE_INPUT_MISSING",
        `Measurement model ${model.key} requires table input ${tableKey}`,
        `inputs.${tableKey}`,
      ),
    );
    return [];
  }

  const numericColumns = tableInput.columns.filter(
    (column) => column.type === "number",
  );
  const outputs: MeasurementModelResultLike[] = [];
  const methodModel = compiledModelToMeasurementModel(model);
  const referencedContextKeys = rowMeasurementModelContextKeys(
    methodModel,
    tableKey,
  );
  const scopedColumnKeys = rowMeasurementModelTableColumnKeys(
    methodModel,
    tableKey,
  );
  let failed = false;

  for (const [rowIndex, row] of rows.entries()) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      failed = true;
      diagnostics.push(
        errorDiagnostic(
          "ROW_MEASUREMENT_MODEL_TABLE_ROW_INVALID",
          `Measurement model ${model.key} requires row ${rowIndex} from table ${tableKey} to be an object`,
          `inputs.${tableKey}.${rowIndex}`,
        ),
      );
      continue;
    }

    const rowContext: Record<string, NumericInput | readonly NumericInput[]> = {
      ...context,
    };
    for (const variable of referencedContextKeys) {
      const value = context[variable];
      if (Array.isArray(value) && value[rowIndex] !== undefined) {
        const sourceTableKey = rowAlignedArrayTableKey(
          variable,
          inputs,
          formulas,
        );
        if (sourceTableKey === tableKey) {
          rowContext[variable] = value[rowIndex];
        } else if (sourceTableKey) {
          failed = true;
          diagnostics.push(
            errorDiagnostic(
              "ROW_MEASUREMENT_MODEL_CROSS_TABLE_ARRAY",
              `Measurement model ${model.key} cannot use array variable ${variable} from table ${sourceTableKey} while evaluating table ${tableKey}`,
              `measurementModels.${model.key}.${rowIndex}`,
            ),
          );
        }
      }
    }

    const record = row as Record<string, unknown>;
    for (const column of numericColumns) {
      const value = record[column.key];
      if (value === undefined || value === null || value === "") continue;
      if (typeof value !== "string" && typeof value !== "number") continue;
      if (
        context[column.key] !== undefined &&
        !scopedColumnKeys.has(column.key)
      ) {
        continue;
      }
      rowContext[column.key] = value;
    }

    try {
      const result = engine.evaluateMeasurementModel(
        buildMeasurementModelInput(methodModel, rowContext, { engine }),
      );
      assertFiniteNumericOutput(
        result.value,
        `measurementModels.${model.key}.${rowIndex}`,
      );
      outputs[rowIndex] = result;
    } catch (error) {
      failed = true;
      diagnostics.push(
        toPreviewDiagnostic(
          error,
          "ROW_MEASUREMENT_MODEL_PREVIEW_FAILED",
          `Measurement model ${model.key} failed during preview for row ${rowIndex}`,
          `measurementModels.${model.key}.${rowIndex}`,
        ),
      );
    }
  }

  return failed ? [] : outputs;
}

function rowMeasurementModelContextKeys(
  model: MethodMeasurementModel,
  tableKey: string,
): Set<string> {
  const keys = new Set<string>();
  for (const quantity of model.quantities) {
    addQuantitySourceContextKey(quantity.source, keys, tableKey);
    if (quantity.uncertainty.kind === "type_a") {
      if (quantity.uncertainty.observationsInputKey) {
        keys.add(quantity.uncertainty.observationsInputKey);
      }
      for (const source of quantity.uncertainty.observations ?? []) {
        addQuantitySourceContextKey(source, keys, tableKey);
      }
    }
  }
  return keys;
}

function rowMeasurementModelTableColumnKeys(
  model: MethodMeasurementModel,
  tableKey: string,
): Set<string> {
  const keys = new Set<string>();
  for (const quantity of model.quantities) {
    addTableColumnSourceKey(quantity.source, keys, tableKey);
    if (quantity.uncertainty.kind === "type_a") {
      for (const source of quantity.uncertainty.observations ?? []) {
        addTableColumnSourceKey(source, keys, tableKey);
      }
    }
  }
  return keys;
}

function addQuantitySourceContextKey(
  source: MethodMeasurementModel["quantities"][number]["source"],
  keys: Set<string>,
  tableKey: string,
): void {
  if (source.kind === "constant") return;
  if (source.kind === "table_column") {
    if (source.tableKey === tableKey) keys.add(source.columnKey);
    return;
  }
  keys.add(source.key);
}

function addTableColumnSourceKey(
  source: MethodMeasurementModel["quantities"][number]["source"],
  keys: Set<string>,
  tableKey: string,
): void {
  if (source.kind === "table_column" && source.tableKey === tableKey) {
    keys.add(source.columnKey);
  }
}

function rowAlignedArrayTableKey(
  variable: string,
  inputs: readonly MethodInput[],
  formulas: readonly CompiledFormulaDefinition[],
): string | null {
  const input = inputs.find((item) => item.key === variable);
  if (
    input?.kind === "scalar" &&
    input.metadata?.source === "variable_binding" &&
    input.metadata.bindingSource === "table_column" &&
    typeof input.metadata.fieldKey === "string"
  ) {
    return input.metadata.fieldKey;
  }

  const formula = formulas.find((item) => item.key === variable);
  if (formula?.scope?.kind === "table_row") return formula.scope.tableKey;

  return null;
}

function buildPreviewContext(
  inputs: readonly MethodInput[],
  values: Record<string, unknown>,
  diagnostics: MethodDiagnostic[],
  calibrationPhases: CalibrationPhaseSnapshot | undefined,
): Record<string, NumericInput | readonly NumericInput[]> {
  const context: Record<string, NumericInput | readonly NumericInput[]> = {};

  for (const input of inputs) {
    if (!isPhaseActive(input.metadata, calibrationPhases)) continue;
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

    let value = values[input.key] as PreviewInputValue | undefined;
    if (value === undefined || value === null || value === "") {
      if (input.kind === "scalar" && input.defaultValue !== undefined) {
        value = input.defaultValue;
      } else {
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
          if (!isColumnPhaseActive(input, column.key, calibrationPhases)) {
            continue;
          }
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

function isColumnPhaseActive(
  input: MethodInput & { kind: "table" },
  columnKey: string,
  calibrationPhases: CalibrationPhaseSnapshot | undefined,
): boolean {
  if (isPhaseBlockNotPerformed(input.metadata, calibrationPhases)) {
    return false;
  }
  const column = input.columns.find((item) => item.key === columnKey);
  const phase = column?.phase;
  if (!phase || phase === "always") return true;
  return isPhaseSelectionActive(input.metadata, phase, calibrationPhases);
}

function isPhaseActive(
  metadata: Record<string, unknown> | undefined,
  calibrationPhases: CalibrationPhaseSnapshot | undefined,
): boolean {
  if (isPhaseBlockNotPerformed(metadata, calibrationPhases)) return false;
  const phase = metadata?.phase;
  if (phase !== "before" && phase !== "after") return true;
  return isPhaseSelectionActive(metadata, phase, calibrationPhases);
}

function isPhaseBlockNotPerformed(
  metadata: Record<string, unknown> | undefined,
  calibrationPhases: CalibrationPhaseSnapshot | undefined,
): boolean {
  const phaseBlock = metadata?.phaseBlock;
  if (typeof phaseBlock !== "string" || phaseBlock.trim() === "") {
    return false;
  }
  return calibrationPhases?.blocks?.[phaseBlock]?.mode === "not_performed";
}

function isPhaseSelectionActive(
  metadata: Record<string, unknown> | undefined,
  phase: CalibrationPhase,
  calibrationPhases: CalibrationPhaseSnapshot | undefined,
): boolean {
  const phaseBlock = metadata?.phaseBlock;
  if (typeof phaseBlock !== "string" || phaseBlock.trim() === "") {
    return true;
  }
  const mode =
    calibrationPhases?.blocks?.[phaseBlock]?.mode ?? "before_and_after";
  if (mode === "before_and_after") return true;
  if (mode === "before_only") return phase === "before";
  if (mode === "after_only") return phase === "after";
  if (mode === "not_performed") return false;
  return true;
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
  if (allValuesEqual(values)) return 0;
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
    compiled.leftVariables,
  );
  const rightPrepared = prepareFormulaEvaluation(
    compiled.rightExpression,
    context,
    compiled.rightVariables,
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
  options: {
    aggregateContext?: Record<string, NumericInput | readonly NumericInput[]>;
  } = {},
): { expression: string; inputs: Record<string, NumericInput> } {
  const aggregateInputs: Record<string, NumericInput> = {};
  const consumedVariables = new Set<string>();
  const rewrittenExpression = rewriteArrayAggregates(
    expression,
    context,
    aggregateInputs,
    consumedVariables,
    options.aggregateContext ?? context,
  );
  const inputs = pickNumericContext(
    context,
    variables.filter(
      (variable) =>
        !consumedVariables.has(variable) ||
        (!Array.isArray(context[variable]) &&
          !isVariableUsedOnlyInArrayAggregator(expression, variable)),
    ),
    { allowArrays: true },
  );
  return {
    expression: rewrittenExpression,
    inputs: { ...inputs, ...aggregateInputs },
  };
}

function isVariableUsedOnlyInWholeArrayAggregate(
  expression: string,
  variable: string,
): boolean {
  return isVariableUsedOnlyInAggregateMatching(
    expression,
    variable,
    (argument) => argument.trim() === variable,
  );
}

function isVariableUsedOnlyInArrayAggregator(
  expression: string,
  variable: string,
): boolean {
  return isVariableUsedOnlyInAggregateMatching(
    expression,
    variable,
    (argument) =>
      aggregateVariableTokensFromExpression(argument).includes(variable),
  );
}

function isVariableUsedOnlyInAggregateMatching(
  expression: string,
  variable: string,
  matchesArgument: (argument: string) => boolean,
): boolean {
  const variablePattern = new RegExp(`\\b${escapeRegex(variable)}\\b`, "g");
  const allOccurrences = [...expression.matchAll(variablePattern)];
  if (allOccurrences.length === 0) return true;

  const aggregatePattern =
    /\b(?:mean|std|min|max)\s*\(\s*(\[[^\]]*\]|[A-Za-z][A-Za-z0-9_]*)\s*(?:,\s*\d+)?\s*\)/g;
  const coveredRanges = [...expression.matchAll(aggregatePattern)]
    .filter(
      (match) =>
        match[1] !== undefined &&
        matchesArgument(match[1]) &&
        match.index !== undefined,
    )
    .map((match) => ({
      start: match.index!,
      end: match.index! + match[0].length,
    }));

  return allOccurrences.every((match) => {
    const index = match.index ?? -1;
    return coveredRanges.some(
      (range) => index >= range.start && index < range.end,
    );
  });
}

function aggregateVariableTokensFromExpression(argument: string): string[] {
  return [
    ...new Set(argument.match(/[A-Za-z][A-Za-z0-9_]*/g)?.filter(Boolean) ?? []),
  ];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rewriteArrayAggregates(
  expression: string,
  context: Record<string, NumericInput | readonly NumericInput[]>,
  aggregateInputs: Record<string, NumericInput>,
  consumedVariables: Set<string>,
  aggregateContext: Record<string, NumericInput | readonly NumericInput[]>,
): string {
  const reserved = new Set(Object.keys(context));
  let index = Object.keys(aggregateInputs).length;
  return expression.replace(
    /\b(mean|std|min|max)\s*\(\s*(\[[^\]]*\]|[A-Za-z][A-Za-z0-9_]*)\s*(?:,\s*(\d+))?\s*\)/g,
    (match, functionName: string, argument: string, correction?: string) => {
      const trimmedArgument = argument.trim();
      const argumentContext =
        trimmedArgument.startsWith("[") && trimmedArgument.endsWith("]")
          ? context
          : aggregateContext;
      const values = resolveInlineNumericArguments(argument, argumentContext);
      if (!values.length) return match;

      const value = aggregateValues(functionName, values, correction);
      if (!Number.isFinite(value)) return match;

      let key = `cf_internal_preview_${index++}`;
      while (reserved.has(key) || key in aggregateInputs) {
        key = `cf_internal_preview_${index++}`;
      }
      aggregateInputs[key] = value;
      for (const variable of aggregateVariableTokens(
        argument,
        argumentContext,
      )) {
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
      return sum(values) / values.length;
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
  context: Record<string, NumericInput | readonly NumericInput[]>,
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
  if (allValuesEqual(values)) return 0;

  const mean = sum(values) / values.length;
  const variance =
    values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / denominator;
  return Math.sqrt(variance);
}

function allValuesEqual(values: readonly number[]): boolean {
  return values.every((value) => value === values[0]);
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
  actual: string | number | readonly (string | number)[],
  expected: string | number | readonly (string | number)[] | undefined,
  path: string,
  diagnostics: MethodDiagnostic[],
): void {
  if (expected === undefined) return;
  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected)) {
      diagnostics.push(
        errorDiagnostic(
          "PREVIEW_EXPECTED_VALUE_MISMATCH",
          `Preview expected ${path} to be an array`,
          path,
        ),
      );
      return;
    }
    if (actual.length !== expected.length) {
      diagnostics.push(
        errorDiagnostic(
          "PREVIEW_EXPECTED_VALUE_MISMATCH",
          `Preview expected ${expected.length} values at ${path} but got ${actual.length}`,
          path,
        ),
      );
      return;
    }
    for (const [index, item] of actual.entries()) {
      validateExpected(item, expected[index], `${path}.${index}`, diagnostics);
    }
    return;
  }
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
    scope: model.scope,
    measurand: model.key,
    expression: model.expression,
    quantities: model.quantities,
    correlations: model.correlations,
    covariances: model.covariances,
    coverageProbability: model.coverageProbability,
    coverageFactor: model.coverageFactor,
    options: model.options,
    metadata: model.metadata,
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
