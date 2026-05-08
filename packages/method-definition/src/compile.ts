import { compileCriterionExpression } from "./criteria";
import { errorDiagnostic, hasErrors } from "./diagnostics";
import { canonicalJson, fingerprintJson } from "./fingerprint";
import { parseMethodDraft } from "./normalize";
import { deepFreezeJsonLike } from "./safety";
import type {
  CompiledFormulaDefinition,
  CompiledFormulaLike,
  CompiledMeasurementModelDefinition,
  CompiledMethod,
  CompileMethodOptions,
  CalculationEngineLike,
  InputQuantityLike,
  MeasurementModelInputLike,
  CompileMethodResult,
  EngineMetadata,
  MethodDiagnostic,
  MethodDraft,
  MethodFormula,
  MethodInput,
  MethodMeasurementModel,
  MethodQuantity,
  NormalizedAcceptanceCriterion,
  NumericInput,
} from "./types";
import {
  METHOD_DEFINITION_CORE_VERSION,
  METHOD_ENGINE_PACKAGE_NAME,
} from "./types";
import { runMethodPreview } from "./preview";

type FormulaCompileEntry = {
  formula: MethodFormula;
  compiled: CompiledFormulaLike;
  dependencies: string[];
};

type CompileContext = {
  engine: CalculationEngineLike;
  draft: MethodDraft;
  diagnostics: MethodDiagnostic[];
  inputKeys: Set<string>;
  numericInputKeys: Set<string>;
  formulaKeys: Set<string>;
  modelKeys: Set<string>;
  inputByKey: Map<string, MethodInput>;
};

export const DEFAULT_ENGINE_METADATA: EngineMetadata = {
  packageName: METHOD_ENGINE_PACKAGE_NAME,
  version: "unknown",
  optionsFingerprint: "engine-options:unknown",
};

export function compileMethodDraft(
  input: unknown,
  options: CompileMethodOptions,
): CompileMethodResult {
  const diagnostics: MethodDiagnostic[] = [];
  let draft: MethodDraft;

  try {
    draft = parseMethodDraft(input);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        errorDiagnostic(
          "METHOD_SHAPE_INVALID",
          error instanceof Error ? error.message : "Invalid method draft",
          "draft",
        ),
      ],
    };
  }

  const engine = options.engine;
  const engineMetadata = options.engineMetadata ?? DEFAULT_ENGINE_METADATA;

  const context: CompileContext = {
    engine,
    draft,
    diagnostics,
    inputKeys: new Set(draft.inputs.map((item) => item.key)),
    numericInputKeys: new Set(
      draft.inputs
        .filter((item) => item.kind === "scalar")
        .map((item) => item.key),
    ),
    formulaKeys: new Set(draft.formulas.map((item) => item.key)),
    modelKeys: new Set(draft.measurementModels.map((item) => item.key)),
    inputByKey: new Map(draft.inputs.map((item) => [item.key, item])),
  };

  validateNamespace(context);

  const compiledFormulaEntries = compileFormulas(context);
  const orderedFormulaEntries = orderFormulaEntries(
    compiledFormulaEntries,
    diagnostics,
  );
  const compiledFormulas = orderedFormulaEntries.map(
    toCompiledFormulaDefinition,
  );
  const compiledModels = compileMeasurementModels(context);
  const compiledCriteria = compileAcceptanceCriteria(context);
  const previewScenarios = options.previewScenarios ?? draft.previewScenarios;

  if (options.requirePublishable && previewScenarios.length === 0) {
    diagnostics.push(
      errorDiagnostic(
        "PREVIEW_REQUIRED",
        "Publishing requires at least one valid preview scenario",
        "previewScenarios",
      ),
    );
  }

  if (hasErrors(diagnostics)) {
    return { ok: false, diagnostics, draft };
  }

  const methodForFingerprint = {
    ...draft,
    previewScenarios:
      options.includePreviewScenariosInFingerprint === false
        ? []
        : draft.previewScenarios,
    formulas: compiledFormulas,
    measurementModels: compiledModels,
    acceptanceCriteria: compiledCriteria,
    engine: {
      packageName: "@calibra-facil/math-engine",
      version: engineMetadata.version,
      optionsFingerprint: engineMetadata.optionsFingerprint,
    },
    coreVersion: METHOD_DEFINITION_CORE_VERSION,
  };
  const normalizedMethodJson = canonicalJson(methodForFingerprint);

  const compiledMethod: CompiledMethod = deepFreezeJsonLike({
    methodId: draft.id,
    methodVersion: draft.version,
    status: "compiled",
    engine: {
      packageName: "@calibra-facil/math-engine",
      version: engineMetadata.version,
      optionsFingerprint: engineMetadata.optionsFingerprint,
    },
    coreVersion: METHOD_DEFINITION_CORE_VERSION,
    normalizedMethodJson,
    methodFingerprint: fingerprintJson(methodForFingerprint, "method"),
    inputs: draft.inputs,
    formulas: compiledFormulas,
    measurementModels: compiledModels,
    acceptanceCriteria: compiledCriteria,
    diagnostics: [...diagnostics],
  });

  const previewResults = previewScenarios.map((scenario) =>
    runMethodPreview(compiledMethod, scenario, { engine }),
  );

  const previewDiagnostics = previewResults.flatMap(
    (result) => result.diagnostics,
  );

  if (options.requirePublishable) {
    let positivePreviewPassed = false;
    for (const [index, result] of previewResults.entries()) {
      const scenario = previewScenarios[index];
      if (!result.passed) {
        diagnostics.push(
          errorDiagnostic(
            "PREVIEW_FAILED",
            `Preview scenario ${result.scenarioKey} did not pass`,
            `previewScenarios.${result.scenarioKey}`,
          ),
        );
      }
      if (scenario?.expectFailure) continue;
      if (result.passed) {
        positivePreviewPassed = true;
      }
      for (const criterion of result.acceptanceCriteriaResults) {
        if (!criterion.passed && criterion.severity === "blocking") {
          diagnostics.push(
            errorDiagnostic(
              "BLOCKING_ACCEPTANCE_CRITERION_FAILED",
              criterion.message,
              `acceptanceCriteria.${criterion.key}`,
            ),
          );
        }
      }
    }
    if (!positivePreviewPassed) {
      diagnostics.push(
        errorDiagnostic(
          "POSITIVE_PREVIEW_REQUIRED",
          "Publishing requires at least one passing positive preview scenario",
          "previewScenarios",
        ),
      );
    }
  }

  if (hasErrors(diagnostics)) {
    return { ok: false, diagnostics, draft };
  }

  return {
    ok: true,
    method: deepFreezeJsonLike({
      ...compiledMethod,
      diagnostics: [...diagnostics, ...previewDiagnostics],
    }),
    previewResults,
    diagnostics: [...diagnostics, ...previewDiagnostics],
  };
}

function validateNamespace(context: CompileContext): void {
  const keys = new Map<string, string>();
  for (const input of context.draft.inputs)
    addUnique(keys, input.key, "input", context);
  for (const formula of context.draft.formulas) {
    addUnique(keys, formula.key, "formula", context);
  }
  for (const model of context.draft.measurementModels) {
    addUnique(keys, model.key, "measurementModel", context);
  }

  for (const input of context.draft.inputs) {
    if (input.kind === "table") {
      const columnKeys = new Set<string>();
      for (const column of input.columns) {
        if (columnKeys.has(column.key)) {
          context.diagnostics.push(
            errorDiagnostic(
              "DUPLICATE_TABLE_COLUMN_KEY",
              `Duplicate table column key ${column.key}`,
              `inputs.${input.key}.columns.${column.key}`,
            ),
          );
        }
        columnKeys.add(column.key);
      }
    }
  }
}

function addUnique(
  keys: Map<string, string>,
  key: string,
  kind: string,
  context: CompileContext,
): void {
  const existing = keys.get(key);
  if (existing) {
    context.diagnostics.push(
      errorDiagnostic(
        "DUPLICATE_METHOD_KEY",
        `Key ${key} is used by both ${existing} and ${kind}`,
        key,
      ),
    );
  }
  keys.set(key, kind);
}

function compileFormulas(context: CompileContext): FormulaCompileEntry[] {
  const allowedVariables = [
    ...context.inputKeys,
    ...context.formulaKeys,
  ].sort();
  const entries: FormulaCompileEntry[] = [];

  for (const formula of context.draft.formulas) {
    try {
      const compiled = context.engine.compileFormula(formula.expression, {
        allowedVariables,
      });
      const unknownVariables = compiled.variables.filter(
        (variable) =>
          !context.inputKeys.has(variable) &&
          !context.formulaKeys.has(variable),
      );
      const nonNumericInputVariables = compiled.variables.filter(
        (variable) =>
          context.inputKeys.has(variable) &&
          !context.numericInputKeys.has(variable),
      );
      const directTableColumnVariables = compiled.variables.filter(
        (variable) =>
          isTableColumnBinding(context.inputByKey.get(variable)) &&
          !isVariableUsedOnlyInArrayAggregator(formula.expression, variable),
      );
      for (const variable of unknownVariables) {
        context.diagnostics.push(
          errorDiagnostic(
            "UNKNOWN_FORMULA_VARIABLE",
            `Formula ${formula.key} references unknown variable ${variable}`,
            `formulas.${formula.key}`,
          ),
        );
      }
      for (const variable of nonNumericInputVariables) {
        context.diagnostics.push(
          errorDiagnostic(
            "NON_NUMERIC_FORMULA_VARIABLE",
            `Formula ${formula.key} references non-numeric input ${variable}`,
            `formulas.${formula.key}`,
          ),
        );
      }
      for (const variable of directTableColumnVariables) {
        context.diagnostics.push(
          errorDiagnostic(
            "TABLE_COLUMN_BINDING_REQUIRES_AGGREGATE",
            `Formula ${formula.key} references table-column binding ${variable} directly; use an aggregate such as mean(${variable}) or std(${variable})`,
            `formulas.${formula.key}`,
          ),
        );
      }
      entries.push({
        formula,
        compiled,
        dependencies: compiled.variables.filter((variable) =>
          context.formulaKeys.has(variable),
        ),
      });
    } catch (error) {
      context.diagnostics.push(
        calculationErrorDiagnostic(
          error,
          "FORMULA_COMPILE_FAILED",
          `Formula ${formula.key} failed to compile`,
          `formulas.${formula.key}`,
        ),
      );
    }
  }

  return entries;
}

function orderFormulaEntries(
  entries: FormulaCompileEntry[],
  diagnostics: MethodDiagnostic[],
): FormulaCompileEntry[] {
  const byKey = new Map(entries.map((entry) => [entry.formula.key, entry]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: FormulaCompileEntry[] = [];

  function visit(key: string, stack: string[]): void {
    if (visited.has(key)) return;
    if (visiting.has(key)) {
      diagnostics.push(
        errorDiagnostic(
          "FORMULA_CYCLE",
          `Formula dependency cycle detected: ${[...stack, key].join(" -> ")}`,
          `formulas.${key}`,
        ),
      );
      return;
    }
    const entry = byKey.get(key);
    if (!entry) return;

    visiting.add(key);
    for (const dependency of entry.dependencies)
      visit(dependency, [...stack, key]);
    visiting.delete(key);
    visited.add(key);
    ordered.push(entry);
  }

  for (const entry of entries) visit(entry.formula.key, []);
  return ordered;
}

function toCompiledFormulaDefinition(
  entry: FormulaCompileEntry,
): CompiledFormulaDefinition {
  return {
    key: entry.formula.key,
    label: entry.formula.label,
    expression: entry.formula.expression,
    normalizedFormula: entry.compiled.normalizedFormula,
    formulaFingerprint: entry.compiled.formulaFingerprint,
    variables: [...entry.compiled.variables].sort(),
    ...(entry.formula.outputUnit
      ? { outputUnit: entry.formula.outputUnit }
      : {}),
    ...(entry.formula.outputKind
      ? { outputKind: entry.formula.outputKind }
      : {}),
    ...(entry.formula.reporting ? { reporting: entry.formula.reporting } : {}),
    ...(entry.formula.metadata ? { metadata: entry.formula.metadata } : {}),
  };
}

function compileMeasurementModels(
  context: CompileContext,
): CompiledMeasurementModelDefinition[] {
  const compiledModels: CompiledMeasurementModelDefinition[] = [];

  for (const model of context.draft.measurementModels) {
    try {
      validateMeasurementModelSources(model, context);
      const allowedVariables = model.quantities
        .map((quantity) => quantity.symbol)
        .sort();
      const compiled = context.engine.compileFormula(model.expression, {
        allowedVariables,
      });
      const allowedQuantitySymbols = new Set(allowedVariables);
      const unknownVariables = compiled.variables.filter(
        (variable) => !allowedQuantitySymbols.has(variable),
      );
      if (unknownVariables.length > 0) {
        throw new Error(
          `Measurement model ${model.key} references unknown variable ${unknownVariables.join(", ")}`,
        );
      }
      compiledModels.push({
        key: model.key,
        expression: model.expression,
        normalizedFormula: compiled.normalizedFormula,
        modelFingerprint: fingerprintJson(
          {
            key: model.key,
            expression: model.expression,
            normalizedFormula: compiled.normalizedFormula,
            quantities: model.quantities,
            correlations: model.correlations ?? [],
            covariances: model.covariances ?? [],
            coverageProbability: model.coverageProbability,
            coverageFactor: model.coverageFactor,
          },
          "measurement-model",
        ),
        quantities: model.quantities,
        correlations: model.correlations,
        covariances: model.covariances,
        ...(model.coverageProbability
          ? { coverageProbability: model.coverageProbability }
          : {}),
        ...(model.coverageFactor
          ? { coverageFactor: model.coverageFactor }
          : {}),
        ...(model.options ? { options: model.options } : {}),
      });
    } catch (error) {
      context.diagnostics.push(
        calculationErrorDiagnostic(
          error,
          "MEASUREMENT_MODEL_COMPILE_FAILED",
          `Measurement model ${model.key} failed to compile`,
          `measurementModels.${model.key}`,
        ),
      );
    }
  }

  return compiledModels;
}

function validateMeasurementModelSources(
  model: MethodMeasurementModel,
  context: CompileContext,
): void {
  const quantitySymbols = new Set<string>();
  for (const quantity of model.quantities) {
    if (quantitySymbols.has(quantity.symbol)) {
      throw new Error(`Duplicate quantity symbol ${quantity.symbol}`);
    }
    quantitySymbols.add(quantity.symbol);
    if (
      quantity.source.kind === "input" &&
      !context.inputKeys.has(quantity.source.key)
    ) {
      throw new Error(
        `Quantity ${quantity.symbol} references unknown input ${quantity.source.key}`,
      );
    }
    if (
      quantity.source.kind === "formula" &&
      !context.formulaKeys.has(quantity.source.key)
    ) {
      throw new Error(
        `Quantity ${quantity.symbol} references unknown formula ${quantity.source.key}`,
      );
    }
    if (quantity.uncertainty.kind === "type_a") {
      const observationsInputKey = quantity.uncertainty.observationsInputKey;
      const observationsInput = context.draft.inputs.find(
        (input) => input.key === observationsInputKey,
      );
      if (!observationsInput) {
        throw new Error(
          `Type A quantity ${quantity.symbol} references unknown observations input ${observationsInputKey}`,
        );
      }
      if (observationsInput.kind !== "repeated_observation") {
        throw new Error(
          `Type A quantity ${quantity.symbol} observations input ${observationsInputKey} must be repeated_observation`,
        );
      }
    }
  }
}

function compileAcceptanceCriteria(
  context: CompileContext,
): NormalizedAcceptanceCriterion[] {
  const allowedVariables = [
    ...context.inputKeys,
    ...context.formulaKeys,
    ...context.modelKeys,
  ].sort();
  const compiledCriteria: NormalizedAcceptanceCriterion[] = [];

  for (const criterion of context.draft.acceptanceCriteria) {
    try {
      const compiled = compileCriterionExpression(
        criterion,
        context.engine,
        allowedVariables,
        (value) => fingerprintJson(value, "acceptance-criterion"),
      );
      const nonNumericInputVariables = compiled.variables.filter(
        (variable) =>
          context.inputKeys.has(variable) &&
          !context.numericInputKeys.has(variable),
      );
      const directTableColumnVariables = compiled.variables.filter(
        (variable) =>
          isTableColumnBinding(context.inputByKey.get(variable)) &&
          !isVariableUsedOnlyInArrayAggregator(criterion.expression, variable),
      );
      for (const variable of nonNumericInputVariables) {
        context.diagnostics.push(
          errorDiagnostic(
            "NON_NUMERIC_ACCEPTANCE_CRITERION_VARIABLE",
            `Acceptance criterion ${criterion.key} references non-numeric input ${variable}`,
            `acceptanceCriteria.${criterion.key}`,
          ),
        );
      }
      for (const variable of directTableColumnVariables) {
        context.diagnostics.push(
          errorDiagnostic(
            "TABLE_COLUMN_BINDING_REQUIRES_AGGREGATE",
            `Acceptance criterion ${criterion.key} references table-column binding ${variable} directly; use an aggregate such as mean(${variable}) or std(${variable})`,
            `acceptanceCriteria.${criterion.key}`,
          ),
        );
      }
      compiledCriteria.push({
        ...criterion,
        normalizedFormula: compiled.normalizedFormula,
        variables: compiled.variables,
        criterionFingerprint: compiled.criterionFingerprint,
      });
    } catch (error) {
      context.diagnostics.push(
        calculationErrorDiagnostic(
          error,
          "ACCEPTANCE_CRITERION_COMPILE_FAILED",
          `Acceptance criterion ${criterion.key} failed to compile`,
          `acceptanceCriteria.${criterion.key}`,
        ),
      );
    }
  }

  return compiledCriteria;
}

function isTableColumnBinding(input: MethodInput | undefined): boolean {
  return (
    input?.kind === "scalar" &&
    input.metadata?.source === "variable_binding" &&
    input.metadata.bindingSource === "table_column"
  );
}

function isVariableUsedOnlyInArrayAggregator(
  expression: string,
  variable: string,
): boolean {
  const variablePattern = new RegExp(`\\b${escapeRegex(variable)}\\b`, "g");
  const allOccurrences = [...expression.matchAll(variablePattern)];
  if (allOccurrences.length === 0) return true;

  const aggregatePattern =
    /\b(?:mean|std)\s*\(\s*([A-Za-z][A-Za-z0-9_]*)\s*(?:,\s*\d+)?\s*\)/g;
  const coveredRanges = [...expression.matchAll(aggregatePattern)]
    .filter((match) => match[1] === variable && match.index !== undefined)
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildMeasurementModelInput(
  model: MethodMeasurementModel,
  context: Record<string, NumericInput | readonly NumericInput[]>,
): MeasurementModelInputLike {
  const quantities: Record<string, InputQuantityLike> = {};
  for (const quantity of model.quantities) {
    quantities[quantity.symbol] = buildInputQuantity(quantity, context);
  }
  return {
    formula: model.expression,
    quantities,
    correlations: model.correlations?.map((item) => [
      item.symbols[0],
      item.symbols[1],
      item.coefficient,
    ]),
    covariances: model.covariances?.map((item) => [
      item.symbols[0],
      item.symbols[1],
      item.covariance,
    ]),
    coverageProbability: model.coverageProbability,
    coverageFactor: model.coverageFactor,
    allowNonSmoothWithExplicitSensitivities:
      model.options?.allowNonSmoothWithExplicitSensitivities,
  };
}

function buildInputQuantity(
  quantity: MethodQuantity,
  context: Record<string, NumericInput | readonly NumericInput[]>,
): InputQuantityLike {
  const base: InputQuantityLike = {
    unit: quantity.unit,
    degreesOfFreedom: quantity.degreesOfFreedom,
    sensitivityCoefficient: quantity.sensitivity,
    metadata: quantity.metadata,
  };

  const estimate = resolveQuantityEstimate(quantity, context);

  if (quantity.uncertainty.kind === "type_a") {
    const observations = context[quantity.uncertainty.observationsInputKey];
    if (!Array.isArray(observations)) {
      throw new Error(
        `Type A quantity ${quantity.symbol} requires repeated observations`,
      );
    }
    return {
      ...base,
      repeatedObservations: observations,
      degreesOfFreedom:
        quantity.degreesOfFreedom ??
        quantity.uncertainty.minDegreesOfFreedom ??
        undefined,
    };
  }

  if (quantity.uncertainty.kind === "type_b") {
    const source = quantity.uncertainty;
    return {
      ...base,
      estimate,
      distribution:
        source.distribution === "u_shaped" ? "u-shaped" : source.distribution,
      standardUncertainty: source.standardUncertainty,
      halfWidth: source.halfWidth,
      lowerLimit: source.limits?.lower,
      upperLimit: source.limits?.upper,
      expandedUncertainty: source.expandedUncertainty,
      coverageFactor: source.coverageFactor,
      typeB: {
        distribution:
          source.distribution === "u_shaped" ? "u-shaped" : source.distribution,
        standardUncertainty: source.standardUncertainty,
        halfWidth: source.halfWidth,
        lowerLimit: source.limits?.lower,
        upperLimit: source.limits?.upper,
        expandedUncertainty: source.expandedUncertainty,
        coverageFactor: source.coverageFactor,
        divisor: source.divisor,
      },
      degreesOfFreedom:
        quantity.degreesOfFreedom ?? source.degreesOfFreedom ?? undefined,
    };
  }

  return {
    ...base,
    estimate,
    standardUncertainty: quantity.uncertainty.standardUncertainty,
    degreesOfFreedom:
      quantity.degreesOfFreedom ?? quantity.uncertainty.degreesOfFreedom,
  };
}

function resolveQuantityEstimate(
  quantity: MethodQuantity,
  context: Record<string, NumericInput | readonly NumericInput[]>,
): NumericInput {
  if (quantity.source.kind === "constant") return quantity.source.value;
  const value = context[quantity.source.key];
  if (Array.isArray(value)) {
    throw new Error(`Quantity ${quantity.symbol} source must be scalar`);
  }
  if (value === undefined) {
    throw new Error(`Quantity ${quantity.symbol} source is missing`);
  }
  if (typeof value === "string" || typeof value === "number") return value;
  throw new Error(`Quantity ${quantity.symbol} source must be scalar`);
}

function calculationErrorDiagnostic(
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
      {
        engineCode: error.code,
      },
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

export function inputIsNumeric(input: MethodInput): boolean {
  return input.kind === "scalar";
}
