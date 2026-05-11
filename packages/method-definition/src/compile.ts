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
  QuantitySource,
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
  normalizedFormula: string;
  formulaFingerprint: string;
  variables: string[];
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

  const { status: _workflowStatus, ...draftContent } = draft;
  const methodForFingerprint = {
    ...draftContent,
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
    return {
      ok: false,
      diagnostics: [...diagnostics, ...previewDiagnostics],
      draft,
    };
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
  const formulaByKey = new Map(
    context.draft.formulas.map((formula) => [formula.key, formula]),
  );
  const entries: FormulaCompileEntry[] = [];

  for (const formula of context.draft.formulas) {
    const allowedVariables = formulaAllowedVariables(formula, context);
    const aggregateRewrite = rewriteAggregatesForCompile(
      formula.expression,
      allowedVariables,
    );
    const allowedVariableSet = new Set([
      ...allowedVariables,
      ...aggregateRewrite.syntheticVariables,
    ]);
    const formulaScope = getFormulaScope(formula);
    try {
      const compiled = context.engine.compileFormula(
        aggregateRewrite.expression,
        {
          allowedVariables: [...allowedVariableSet].sort(),
        },
      );
      const variables = [
        ...new Set(
          compiled.variables
            .filter(
              (variable) => !aggregateRewrite.syntheticVariables.has(variable),
            )
            .concat([...aggregateRewrite.consumedVariables]),
        ),
      ].sort();
      const unknownVariables = variables.filter(
        (variable) => !allowedVariableSet.has(variable),
      );
      const nonNumericInputVariables = variables.filter(
        (variable) =>
          context.inputKeys.has(variable) &&
          !context.numericInputKeys.has(variable) &&
          !isAggregateOnlyInput(
            context.inputByKey.get(variable),
            formula.expression,
            variable,
          ),
      );
      const directTableColumnVariables = variables.filter(
        (variable) =>
          formulaScope.kind === "scalar" &&
          isTableColumnBinding(context.inputByKey.get(variable)) &&
          !isVariableUsedOnlyInArrayAggregator(formula.expression, variable),
      );
      const directRowFormulaVariables = variables.filter(
        (variable) =>
          formulaScope.kind === "scalar" &&
          formulaByKey.get(variable)?.scope?.kind === "table_row" &&
          !isVariableUsedOnlyInArrayAggregator(formula.expression, variable),
      );
      const rowColumnVariables =
        formulaScope.kind === "table_row"
          ? rowFormulaNumericColumnKeys(formula, context)
          : new Set<string>();
      const ambiguousRowVariables =
        formulaScope.kind === "table_row"
          ? variables.filter(
              (variable) =>
                rowColumnVariables.has(variable) &&
                context.formulaKeys.has(variable),
            )
          : [];
      for (const variable of unknownVariables) {
        context.diagnostics.push(
          errorDiagnostic(
            "UNKNOWN_FORMULA_VARIABLE",
            `Formula ${formula.key} references unknown variable ${variable}`,
            `formulas.${formula.key}`,
          ),
        );
      }
      if (formulaScope.kind === "table_row") {
        const currentTableKey = formulaScope.tableKey;
        for (const variable of variables) {
          const dependency = formulaByKey.get(variable);
          const requiresRowAlignedValue = !isVariableUsedOnlyInArrayAggregator(
            formula.expression,
            variable,
          );
          const tableBindingTableKey = tableColumnBindingTableKey(
            context.inputByKey.get(variable),
          );
          if (
            requiresRowAlignedValue &&
            tableBindingTableKey &&
            tableBindingTableKey !== currentTableKey
          ) {
            context.diagnostics.push(
              errorDiagnostic(
                "ROW_FORMULA_CROSS_TABLE_BINDING",
                `Row formula ${formula.key} cannot reference table-column binding ${variable} from table ${tableBindingTableKey}`,
                `formulas.${formula.key}`,
              ),
            );
          }
          if (
            requiresRowAlignedValue &&
            dependency?.scope?.kind === "table_row" &&
            dependency.scope.tableKey !== currentTableKey
          ) {
            context.diagnostics.push(
              errorDiagnostic(
                "ROW_FORMULA_CROSS_TABLE_DEPENDENCY",
                `Row formula ${formula.key} cannot reference row formula ${variable} from table ${dependency.scope.tableKey}`,
                `formulas.${formula.key}`,
              ),
            );
          }
        }
      }
      for (const variable of ambiguousRowVariables) {
        context.diagnostics.push(
          errorDiagnostic(
            "ROW_FORMULA_VARIABLE_COLLISION",
            `Row formula ${formula.key} references ${variable}, which is both a row column and a formula output; use distinct keys`,
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
      for (const variable of directRowFormulaVariables) {
        context.diagnostics.push(
          errorDiagnostic(
            "ROW_FORMULA_OUTPUT_REQUIRES_AGGREGATE",
            `Formula ${formula.key} references row formula output ${variable} directly; use an aggregate such as mean(${variable}), min(${variable}), or max(${variable})`,
            `formulas.${formula.key}`,
          ),
        );
      }
      entries.push({
        formula,
        compiled,
        normalizedFormula: compiled.normalizedFormula,
        formulaFingerprint: fingerprintJson(
          {
            key: formula.key,
            expression: formula.expression,
            rewrittenExpression: aggregateRewrite.expression,
            normalizedFormula: compiled.normalizedFormula,
            scope: formula.scope ?? { kind: "scalar" },
          },
          "formula",
        ),
        variables,
        dependencies: variables.filter(
          (variable) =>
            context.formulaKeys.has(variable) &&
            !rowColumnVariables.has(variable),
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
      const tokens = aggregateVariableTokens(argument);
      if (tokens.length === 0) return match;
      for (const token of tokens) consumedVariables.add(token);
      let key = `cf_internal_agg_${index++}`;
      while (reserved.has(key) || syntheticVariables.has(key)) {
        key = `cf_internal_agg_${index++}`;
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

function aggregateVariableTokens(argument: string): string[] {
  return [
    ...new Set(argument.match(/[A-Za-z][A-Za-z0-9_]*/g)?.filter(Boolean) ?? []),
  ];
}

function formulaAllowedVariables(
  formula: MethodFormula,
  context: CompileContext,
): string[] {
  const scope = getFormulaScope(formula);
  if (scope.kind === "scalar") {
    return [...context.inputKeys, ...context.formulaKeys].sort();
  }

  const tableInput = context.draft.inputs.find(
    (input) => input.kind === "table" && input.key === scope.tableKey,
  );
  if (!tableInput || tableInput.kind !== "table") {
    context.diagnostics.push(
      errorDiagnostic(
        "ROW_FORMULA_TABLE_UNKNOWN",
        `Row formula ${formula.key} references unknown table ${scope.tableKey}`,
        `formulas.${formula.key}.scope.tableKey`,
      ),
    );
    return [...context.numericInputKeys, ...context.formulaKeys].sort();
  }

  const numericColumnKeys = tableInput.columns
    .filter((column) => column.type === "number")
    .map((column) => column.key);

  return [
    ...context.inputKeys,
    ...numericColumnKeys,
    ...context.formulaKeys,
  ].sort();
}

function rowFormulaNumericColumnKeys(
  formula: MethodFormula,
  context: CompileContext,
): Set<string> {
  const scope = getFormulaScope(formula);
  if (scope.kind !== "table_row") return new Set();
  const tableInput = context.draft.inputs.find(
    (input) => input.kind === "table" && input.key === scope.tableKey,
  );
  if (!tableInput || tableInput.kind !== "table") return new Set();
  return new Set(
    tableInput.columns
      .filter((column) => column.type === "number")
      .map((column) => column.key),
  );
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
    ...(entry.formula.scope ? { scope: entry.formula.scope } : {}),
    normalizedFormula: entry.normalizedFormula,
    formulaFingerprint: entry.formulaFingerprint,
    variables: entry.variables,
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
        ...(model.scope ? { scope: model.scope } : {}),
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
            scope: model.scope ?? { kind: "scalar" },
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
  const modelScope = model.scope ?? { kind: "scalar" as const };
  if (modelScope.kind === "table_row") {
    const tableInput = context.draft.inputs.find(
      (input) => input.kind === "table" && input.key === modelScope.tableKey,
    );
    if (!tableInput || tableInput.kind !== "table") {
      throw new Error(
        `Measurement model ${model.key} references unknown table ${modelScope.tableKey}`,
      );
    }
  }
  for (const quantity of model.quantities) {
    if (quantitySymbols.has(quantity.symbol)) {
      throw new Error(`Duplicate quantity symbol ${quantity.symbol}`);
    }
    quantitySymbols.add(quantity.symbol);
    validateQuantitySource(quantity.source, quantity.symbol, model, context);
    if (quantity.uncertainty.kind === "type_a") {
      const observationsInputKey = quantity.uncertainty.observationsInputKey;
      if (observationsInputKey) {
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
      if (quantity.uncertainty.observations) {
        for (const source of quantity.uncertainty.observations) {
          validateQuantitySource(source, quantity.symbol, model, context);
        }
      }
      if (!observationsInputKey && !quantity.uncertainty.observations?.length) {
        throw new Error(
          `Type A quantity ${quantity.symbol} requires observationsInputKey or observations`,
        );
      }
    }
  }
}

function validateQuantitySource(
  source: QuantitySource,
  symbol: string,
  model: MethodMeasurementModel,
  context: CompileContext,
): void {
  if (source.kind === "constant") return;

  if (source.kind === "input") {
    if (!context.inputKeys.has(source.key)) {
      throw new Error(
        `Quantity ${symbol} references unknown input ${source.key}`,
      );
    }
    const input = context.inputByKey.get(source.key);
    if (input?.kind === "table") {
      throw new Error(
        `Quantity ${symbol} input source ${source.key} must be scalar`,
      );
    }
    return;
  }

  if (source.kind === "formula") {
    if (!context.formulaKeys.has(source.key)) {
      throw new Error(
        `Quantity ${symbol} references unknown formula ${source.key}`,
      );
    }
    const dependency = context.draft.formulas.find(
      (formula) => formula.key === source.key,
    );
    if (
      dependency?.scope?.kind === "table_row" &&
      model.scope?.kind !== "table_row"
    ) {
      throw new Error(
        `Quantity ${symbol} references row formula ${source.key}; scalar measurement models require an aggregate scalar formula`,
      );
    }
    if (
      model.scope?.kind === "table_row" &&
      dependency?.scope?.kind === "table_row" &&
      dependency.scope.tableKey !== model.scope.tableKey
    ) {
      throw new Error(
        `Quantity ${symbol} references row formula ${source.key} from table ${dependency.scope.tableKey}`,
      );
    }
    return;
  }

  const tableInput = context.draft.inputs.find(
    (input) => input.kind === "table" && input.key === source.tableKey,
  );
  if (!tableInput || tableInput.kind !== "table") {
    throw new Error(
      `Quantity ${symbol} references unknown table ${source.tableKey}`,
    );
  }
  if (model.scope?.kind !== "table_row") {
    throw new Error(
      `Quantity ${symbol} table column source requires a table-row measurement model`,
    );
  }
  if (model.scope.tableKey !== source.tableKey) {
    throw new Error(
      `Quantity ${symbol} references table ${source.tableKey} outside model scope ${model.scope.tableKey}`,
    );
  }
  const column = tableInput.columns.find(
    (item) => item.key === source.columnKey,
  );
  if (!column) {
    throw new Error(
      `Quantity ${symbol} references unknown column ${source.columnKey}`,
    );
  }
  if (column.type !== "number") {
    throw new Error(
      `Quantity ${symbol} column source ${source.columnKey} must be numeric`,
    );
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
  const formulaByKey = new Map(
    context.draft.formulas.map((formula) => [formula.key, formula]),
  );
  const modelByKey = new Map(
    context.draft.measurementModels.map((model) => [model.key, model]),
  );
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
          !context.numericInputKeys.has(variable) &&
          !isAggregateOnlyInput(
            context.inputByKey.get(variable),
            criterion.expression,
            variable,
          ),
      );
      const directTableColumnVariables = compiled.variables.filter(
        (variable) =>
          isTableColumnBinding(context.inputByKey.get(variable)) &&
          !isVariableUsedOnlyInArrayAggregator(criterion.expression, variable),
      );
      const directRowFormulaVariables = compiled.variables.filter(
        (variable) =>
          formulaByKey.get(variable)?.scope?.kind === "table_row" &&
          !isVariableUsedOnlyInArrayAggregator(criterion.expression, variable),
      );
      const directRowModelVariables = compiled.variables.filter(
        (variable) =>
          modelByKey.get(variable)?.scope?.kind === "table_row" &&
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
      for (const variable of directRowFormulaVariables) {
        context.diagnostics.push(
          errorDiagnostic(
            "ROW_FORMULA_OUTPUT_REQUIRES_AGGREGATE",
            `Acceptance criterion ${criterion.key} references row formula output ${variable} directly; use an aggregate such as mean(${variable}), min(${variable}), or max(${variable})`,
            `acceptanceCriteria.${criterion.key}`,
          ),
        );
      }
      for (const variable of directRowModelVariables) {
        context.diagnostics.push(
          errorDiagnostic(
            "ROW_MEASUREMENT_MODEL_OUTPUT_REQUIRES_AGGREGATE",
            `Acceptance criterion ${criterion.key} references row measurement model output ${variable} directly; use an aggregate such as mean(${variable}), min(${variable}), or max(${variable})`,
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

function tableColumnBindingTableKey(
  input: MethodInput | undefined,
): string | null {
  if (!isTableColumnBinding(input)) return null;
  const fieldKey = input?.metadata?.fieldKey;
  return typeof fieldKey === "string" ? fieldKey : null;
}

function isAggregateOnlyInput(
  input: MethodInput | undefined,
  expression: string,
  variable: string,
): boolean {
  return (
    (input?.kind === "repeated_observation" || isTableColumnBinding(input)) &&
    isVariableUsedOnlyInArrayAggregator(expression, variable)
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
    /\b(?:mean|std|min|max)\s*\(\s*(\[[^\]]*\]|[A-Za-z][A-Za-z0-9_]*)\s*(?:,\s*\d+)?\s*\)/g;
  const coveredRanges = [...expression.matchAll(aggregatePattern)]
    .filter(
      (match) =>
        match[1] !== undefined &&
        aggregateVariableTokens(match[1]).includes(variable) &&
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

function getFormulaScope(
  formula: MethodFormula,
): NonNullable<MethodFormula["scope"]> {
  return formula.scope ?? { kind: "scalar" };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildMeasurementModelInput(
  model: MethodMeasurementModel,
  context: Record<string, NumericInput | readonly NumericInput[]>,
  options: { engine?: CalculationEngineLike } = {},
): MeasurementModelInputLike {
  const quantities: Record<string, InputQuantityLike> = {};
  for (const quantity of model.quantities) {
    quantities[quantity.symbol] = buildInputQuantity(
      quantity,
      context,
      options,
    );
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
    coverageFactor: resolveOptionalNumericExpression(
      model.coverageFactor,
      context,
      options.engine,
    ),
    allowNonSmoothWithExplicitSensitivities:
      model.options?.allowNonSmoothWithExplicitSensitivities,
  };
}

function buildInputQuantity(
  quantity: MethodQuantity,
  context: Record<string, NumericInput | readonly NumericInput[]>,
  options: { engine?: CalculationEngineLike },
): InputQuantityLike {
  const base: InputQuantityLike = {
    unit: quantity.unit,
    degreesOfFreedom: resolveOptionalNumericExpression(
      quantity.degreesOfFreedom,
      context,
      options.engine,
    ),
    sensitivityCoefficient: resolveOptionalNumericExpression(
      quantity.sensitivity,
      context,
      options.engine,
    ),
    metadata: quantity.metadata,
  };

  const estimate = resolveQuantityEstimate(quantity, context, options.engine);

  if (quantity.uncertainty.kind === "type_a") {
    const observations = resolveTypeAObservations(
      quantity,
      context,
      options.engine,
    );
    return {
      ...base,
      estimate,
      repeatedObservations: observations,
      degreesOfFreedom: resolveOptionalNumericExpression(
        quantity.degreesOfFreedom ??
          quantity.uncertainty.minDegreesOfFreedom ??
          undefined,
        context,
        options.engine,
      ),
    };
  }

  if (quantity.uncertainty.kind === "type_b") {
    const source = quantity.uncertainty;
    const distribution =
      source.distribution === "u_shaped" ? "u-shaped" : source.distribution;
    const standardUncertainty = resolveOptionalNumericExpression(
      source.standardUncertainty,
      context,
      options.engine,
    );
    const halfWidth = resolveOptionalNumericExpression(
      source.halfWidth,
      context,
      options.engine,
    );
    const lowerLimit = resolveOptionalNumericExpression(
      source.limits?.lower,
      context,
      options.engine,
    );
    const upperLimit = resolveOptionalNumericExpression(
      source.limits?.upper,
      context,
      options.engine,
    );
    const expandedUncertainty = resolveOptionalNumericExpression(
      source.expandedUncertainty,
      context,
      options.engine,
    );
    const coverageFactor = resolveOptionalNumericExpression(
      source.coverageFactor,
      context,
      options.engine,
    );
    return {
      ...base,
      estimate,
      distribution,
      standardUncertainty,
      halfWidth,
      lowerLimit,
      upperLimit,
      expandedUncertainty,
      coverageFactor,
      typeB: {
        distribution,
        standardUncertainty,
        halfWidth,
        lowerLimit,
        upperLimit,
        expandedUncertainty,
        coverageFactor,
        divisor: resolveOptionalNumericExpression(
          source.divisor,
          context,
          options.engine,
        ),
      },
      degreesOfFreedom: resolveOptionalNumericExpression(
        quantity.degreesOfFreedom ?? source.degreesOfFreedom ?? undefined,
        context,
        options.engine,
      ),
    };
  }

  return {
    ...base,
    estimate,
    standardUncertainty: resolveNumericExpression(
      quantity.uncertainty.standardUncertainty,
      context,
      options.engine,
    ),
    degreesOfFreedom: resolveOptionalNumericExpression(
      quantity.degreesOfFreedom ?? quantity.uncertainty.degreesOfFreedom,
      context,
      options.engine,
    ),
  };
}

function resolveQuantityEstimate(
  quantity: MethodQuantity,
  context: Record<string, NumericInput | readonly NumericInput[]>,
  engine?: CalculationEngineLike,
): NumericInput {
  const value = resolveQuantitySource(quantity.source, context, engine);
  if (value === "Infinity") {
    throw new Error(`Quantity ${quantity.symbol} estimate must be finite`);
  }
  return value;
}

function resolveTypeAObservations(
  quantity: MethodQuantity,
  context: Record<string, NumericInput | readonly NumericInput[]>,
  engine?: CalculationEngineLike,
): NumericInput[] {
  if (quantity.uncertainty.kind !== "type_a") return [];
  if (quantity.uncertainty.observations?.length) {
    return quantity.uncertainty.observations.map((source) => {
      const value = resolveQuantitySource(source, context, engine);
      if (value === "Infinity") {
        throw new Error(
          `Type A quantity ${quantity.symbol} observations must be finite`,
        );
      }
      return value;
    });
  }

  const observationsInputKey = quantity.uncertainty.observationsInputKey;
  const observations = observationsInputKey
    ? context[observationsInputKey]
    : undefined;
  if (!Array.isArray(observations)) {
    throw new Error(
      `Type A quantity ${quantity.symbol} requires repeated observations`,
    );
  }
  return observations;
}

function resolveQuantitySource(
  source: QuantitySource,
  context: Record<string, NumericInput | readonly NumericInput[]>,
  engine?: CalculationEngineLike,
): NumericInput | "Infinity" {
  if (source.kind === "constant") {
    return resolveNumericExpression(source.value, context, engine);
  }
  const key = source.kind === "table_column" ? source.columnKey : source.key;
  const value = context[key];
  if (Array.isArray(value)) {
    throw new Error(`Quantity source ${key} must be scalar`);
  }
  if (value === undefined) {
    throw new Error(`Quantity source ${key} is missing`);
  }
  if (typeof value === "string" || typeof value === "number") return value;
  throw new Error(`Quantity source ${key} must be scalar`);
}

function resolveOptionalNumericExpression(
  value: string | number | undefined,
  context: Record<string, NumericInput | readonly NumericInput[]>,
  engine?: CalculationEngineLike,
): NumericInput | "Infinity" | undefined {
  return value === undefined
    ? undefined
    : resolveNumericExpression(value, context, engine);
}

function resolveNumericExpression(
  value: string | number,
  context: Record<string, NumericInput | readonly NumericInput[]>,
  engine?: CalculationEngineLike,
): NumericInput | "Infinity" {
  if (typeof value === "number") return value;
  if (value === "Infinity") return value;
  if (Number.isFinite(Number(value))) return value;

  const directValue = context[value];
  if (typeof directValue === "string" || typeof directValue === "number") {
    return directValue;
  }
  if (!engine) return value;

  const allowedVariables = Object.entries(context)
    .filter(([, item]) => !Array.isArray(item))
    .map(([key]) => key)
    .sort();
  const compiled = engine.compileFormula(value, { allowedVariables });
  const inputs: Record<string, NumericInput> = {};
  for (const variable of compiled.variables) {
    const input = context[variable];
    if (typeof input === "string" || typeof input === "number") {
      inputs[variable] = input;
      continue;
    }
    throw new Error(
      `Expression ${value} references missing scalar ${variable}`,
    );
  }
  return engine.evaluateFormula(compiled, inputs).value;
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
