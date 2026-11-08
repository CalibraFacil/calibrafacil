import {
  FORMULA_REPORTING_GROUPS,
  FORMULA_REPORTING_ROLES,
} from "@calibra-facil/shared";
import { toRecord } from "@calibra-facil/shared/record";
import { parseMethodDraft } from "./normalize";
import type { MethodDraft } from "./types";

/**
 * A method as the product stores and edits it (data fields, variable bindings,
 * formulas, validations: what `calibration_method` rows and the method catalogue
 * hold) converted into the method-definition draft the compiler reads.
 *
 * The ONE conversion: the API (create, publish, review, from-template) and the
 * template catalogue (`buildDraftFromProduct`) both call it, so a field the
 * editor saves reaches the compiled method the same way whoever compiles it.
 * Every function takes `unknown` (a stored jsonb column) and the result goes
 * through `parseMethodDraft`, the schema the draft is proved with.
 */

type DefinitionTableColumn = Extract<
  MethodDraft["inputs"][number],
  { kind: "table" }
>["columns"][number];

type DefinitionMassComposition = NonNullable<
  DefinitionTableColumn["massComposition"]
>;

type DefinitionStandardValue = NonNullable<
  DefinitionTableColumn["standardValue"]
>;

export function productFormatToMethodDraft(
  candidate: Record<string, unknown>,
): MethodDraft {
  const rawInputs = Array.isArray(candidate.dataFields)
    ? candidate.dataFields
    : Array.isArray(candidate.inputs)
      ? candidate.inputs
      : [];
  const rawFormulas = Array.isArray(candidate.formulas)
    ? candidate.formulas
    : [];
  const rawValidations = Array.isArray(candidate.validations)
    ? candidate.validations
    : [];
  const rawMeasurementModels = Array.isArray(candidate.measurementModels)
    ? candidate.measurementModels
    : [];
  const rawVariableBindings = Array.isArray(candidate.variableBindings)
    ? candidate.variableBindings
    : Array.isArray(candidate.variables)
      ? candidate.variables
      : [];
  const inferredVariableBindings = [
    ...buildDefaultVariableBindings(rawInputs),
    ...buildStandardCompatibilityVariableBindings(rawFormulas, rawValidations),
  ];
  const definitionInputs: MethodDraft["inputs"] = [];
  const seenInputKeys = new Set<string>();
  for (const input of rawInputs.map(methodInputToDefinitionInput)) {
    if (!input) continue;
    definitionInputs.push(input);
    seenInputKeys.add(input.key);
  }
  for (const input of rawVariableBindings.map(
    methodVariableBindingToDefinitionInput,
  )) {
    if (!input) continue;
    definitionInputs.push(input);
    seenInputKeys.add(input.key);
  }
  for (const input of inferredVariableBindings.map(
    methodVariableBindingToDefinitionInput,
  )) {
    if (!input || seenInputKeys.has(input.key)) continue;
    definitionInputs.push(input);
    seenInputKeys.add(input.key);
  }

  return parseMethodDraft({
    id: safeMethodId(candidate.id ?? candidate.name ?? "method_draft"),
    version: typeof candidate.version === "number" ? candidate.version : 1,
    status: mapPersistedStatus(candidate.status),
    name: typeof candidate.name === "string" ? candidate.name : "Método",
    description:
      typeof candidate.description === "string"
        ? candidate.description
        : undefined,
    assetTypeId:
      candidate.assetTypeId === undefined || candidate.assetTypeId === null
        ? undefined
        : String(candidate.assetTypeId),
    inputs: definitionInputs,
    formulas: rawFormulas.map(methodFormulaToDefinitionFormula),
    measurementModels: rawMeasurementModels,
    acceptanceCriteria: rawValidations
      .map(methodValidationToAcceptanceCriterion)
      .filter((item): item is NonNullable<typeof item> => item !== null),
    previewScenarios: [],
    metadata: {
      validationStatus: "pending_revalidation",
      source: "method-builder",
    },
  });
}

export function methodInputToDefinitionInput(
  input: unknown,
): MethodDraft["inputs"][number] {
  const record = toRecord(input);
  const key = typeof record.key === "string" ? record.key : "input";
  const label = typeof record.label === "string" ? record.label : key;
  const required = Boolean(record.required);

  if (record.type === "number") {
    const metadata = methodInputExecutionMetadata(record);
    return {
      kind: "scalar",
      key,
      label,
      unit: typeof record.unit === "string" ? record.unit : undefined,
      required,
      defaultValue:
        typeof record.defaultValue === "string" ||
        typeof record.defaultValue === "number"
          ? record.defaultValue
          : undefined,
      quantityKind: "other",
      ...(metadata ? { metadata } : {}),
    };
  }

  if (record.type === "select") {
    return {
      kind: "select",
      key,
      label,
      required,
      options: Array.isArray(record.options)
        ? record.options.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      defaultValue:
        typeof record.defaultValue === "string"
          ? record.defaultValue
          : undefined,
    };
  }

  if (record.type === "table") {
    const metadata = methodInputExecutionMetadata(record);
    return {
      kind: "table",
      key,
      label,
      required,
      ...(metadata ? { metadata } : {}),
      columns: Array.isArray(record.columns)
        ? record.columns
            .map((column) => {
              const tableColumn = toRecord(column);
              if (
                typeof tableColumn.key !== "string" ||
                typeof tableColumn.label !== "string"
              ) {
                return null;
              }

              return {
                key: tableColumn.key,
                label: tableColumn.label,
                type:
                  tableColumn.type === "number"
                    ? ("number" as const)
                    : ("text" as const),
                unit:
                  typeof tableColumn.unit === "string"
                    ? tableColumn.unit
                    : undefined,
                role: methodTableColumnRoleToDefinitionRole(tableColumn.role),
                phase: methodTableColumnPhaseToDefinitionPhase(
                  tableColumn.phase,
                ),
                massComposition: methodTableColumnMassCompositionToDefinition(
                  tableColumn.massComposition,
                ),
                standardValue: methodTableColumnStandardValueToDefinition(
                  tableColumn.standardValue,
                ),
              };
            })
            .filter(
              (column): column is NonNullable<typeof column> => column !== null,
            )
        : [],
    };
  }

  return {
    kind: "text",
    key,
    label,
    required,
    defaultValue:
      typeof record.defaultValue === "string" ? record.defaultValue : undefined,
  };
}

function methodInputExecutionMetadata(
  record: Record<string, unknown>,
): MethodDraft["inputs"][number]["metadata"] {
  const metadata: Record<string, string | number | boolean | null> = {};

  if (record.source === "asset_spec") {
    metadata.source = "asset_spec";
    metadata.assetSpecKey = safeMetadataString(record.assetSpecKey);
    metadata.allowOverride =
      typeof record.allowOverride === "boolean" ? record.allowOverride : null;
  }

  if (typeof record.phaseBlockKey === "string" && record.phaseBlockKey.trim()) {
    metadata.phaseBlock = record.phaseBlockKey.trim();
    metadata.phaseBlockLabel = safeMetadataString(record.phaseBlockLabel);
  }

  const weighingRangeResolver = objectRecord(record.weighingRangeResolver);
  if (weighingRangeResolver) {
    metadata.weighingRangeResolverEnabled =
      weighingRangeResolver.enabled === true;
    metadata.weighingRangeAssetSpecKey = safeMetadataString(
      weighingRangeResolver.assetSpecKey,
    );
    metadata.weighingRangePointColumn = safeMetadataString(
      weighingRangeResolver.pointColumn,
    );
    metadata.weighingRangePointUnit = safeMetadataString(
      weighingRangeResolver.pointUnit,
    );

    const targetColumns = objectRecord(weighingRangeResolver.targetColumns);
    if (targetColumns) {
      for (const key of [
        "rangeLabel",
        "rangeMin",
        "rangeMax",
        "rangeUnit",
        "resolution",
        "resolutionUnit",
      ] as const) {
        metadata[`weighingRangeTarget_${key}`] = safeMetadataString(
          targetColumns[key],
        );
      }
    }
  }

  const eccentricityIndicator = objectRecord(record.eccentricityIndicator);
  if (eccentricityIndicator) {
    metadata.eccentricityIndicatorEnabled =
      eccentricityIndicator.enabled === true;
    metadata.eccentricityIndicatorVariant = safeMetadataString(
      eccentricityIndicator.variant,
    );
    metadata.eccentricityIndicatorPointColumn = safeMetadataString(
      eccentricityIndicator.pointColumn,
    );
    metadata.eccentricityIndicatorLoadPoints = Array.isArray(
      eccentricityIndicator.loadPoints,
    )
      ? eccentricityIndicator.loadPoints
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
          .join(",")
      : null;
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function methodTableColumnRoleToDefinitionRole(
  role: unknown,
): DefinitionTableColumn["role"] {
  return role === "standard_value" || role === "mass_standard_composition"
    ? role
    : undefined;
}

function methodTableColumnPhaseToDefinitionPhase(
  phase: unknown,
): DefinitionTableColumn["phase"] {
  return phase === "before" || phase === "after" || phase === "always"
    ? phase
    : undefined;
}

function methodTableColumnMassCompositionToDefinition(
  value: unknown,
): DefinitionTableColumn["massComposition"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = toRecord(value);
  const targetColumns =
    record.targetColumns &&
    typeof record.targetColumns === "object" &&
    !Array.isArray(record.targetColumns)
      ? methodMassCompositionTargetColumnsToDefinition(record.targetColumns)
      : undefined;
  const normalized: DefinitionMassComposition = {
    ...(isMassCompositionUnit(record.targetUnit)
      ? { targetUnit: record.targetUnit }
      : {}),
    ...(isMassCompositionOptionSource(record.optionSource)
      ? { optionSource: record.optionSource }
      : {}),
    ...(targetColumns ? { targetColumns } : {}),
    ...(record.uncertaintyMode === "expanded_rss" ||
    record.uncertaintyMode === "expanded_arithmetic"
      ? { uncertaintyMode: record.uncertaintyMode }
      : {}),
    ...(isMassCompositionQuantityMode(record.quantityMode)
      ? { quantityMode: record.quantityMode }
      : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function methodMassCompositionTargetColumnsToDefinition(
  value: object,
): DefinitionMassComposition["targetColumns"] {
  const record = toRecord(value);
  const normalized = {
    ...(typeof record.certifiedValue === "string"
      ? { certifiedValue: record.certifiedValue }
      : {}),
    ...(typeof record.compositionLabel === "string"
      ? { compositionLabel: record.compositionLabel }
      : {}),
    ...(typeof record.expandedUncertainty === "string"
      ? { expandedUncertainty: record.expandedUncertainty }
      : {}),
    ...(typeof record.maxError === "string"
      ? { maxError: record.maxError }
      : {}),
    ...(typeof record.drift === "string" ? { drift: record.drift } : {}),
    ...(typeof record.buoyancy === "string"
      ? { buoyancy: record.buoyancy }
      : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function isMassCompositionUnit(value: unknown): value is "mg" | "g" | "kg" {
  return value === "mg" || value === "g" || value === "kg";
}

function isMassCompositionOptionSource(
  value: unknown,
): value is "certified_values" | "composition_profiles" {
  return value === "certified_values" || value === "composition_profiles";
}

function isMassCompositionQuantityMode(
  value: unknown,
): value is "linear_per_item_then_rss" | "profile_linear" {
  return value === "linear_per_item_then_rss" || value === "profile_linear";
}

// Each optional field is conditionally spread: `parseMethodDraft` →
// `assertSafeUnknown` rejects any object key whose value is literally
// `undefined` (as opposed to the key being absent), so an explicit `undefined`
// would make `methodRecordToDraft` (request-approval, quality-approve and
// publish) 500 for any stored method with a formula missing
// unit/reporting/scope/metadata. Mirrors `methodInputToDefinitionInput`'s
// existing `...(metadata ? { metadata } : {})` convention above.
export function methodFormulaToDefinitionFormula(formula: unknown) {
  const record = toRecord(formula);
  const key =
    typeof record.outputKey === "string"
      ? record.outputKey
      : typeof record.key === "string"
        ? record.key
        : "formula";
  const outputUnit =
    typeof record.unit === "string"
      ? record.unit
      : typeof record.outputUnit === "string"
        ? record.outputUnit
        : undefined;
  const reporting = methodFormulaReportingToDefinitionReporting(
    record.reporting,
  );
  const scope = methodFormulaScopeToDefinitionScope(record.scope);
  const metadata = safeDefinitionMetadata(record.metadata);

  return {
    key,
    label: typeof record.label === "string" ? record.label : key,
    expression: typeof record.expression === "string" ? record.expression : "0",
    outputKind: "derived_quantity" as const,
    required: true,
    ...(outputUnit ? { outputUnit } : {}),
    ...(reporting ? { reporting } : {}),
    ...(scope ? { scope } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function methodFormulaScopeToDefinitionScope(scope: unknown) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    return undefined;
  }
  const record = toRecord(scope);
  if (record.kind === "scalar") return { kind: "scalar" as const };
  if (record.kind === "table_row" && typeof record.tableKey === "string") {
    return { kind: "table_row" as const, tableKey: record.tableKey };
  }
  return undefined;
}

export function buildDefaultVariableBindings(
  rawInputs: readonly unknown[],
): unknown[] {
  const bindings: Array<Record<string, unknown>> = [];

  for (const input of rawInputs) {
    const record = toRecord(input);
    if (typeof record.key !== "string") continue;
    const label = typeof record.label === "string" ? record.label : record.key;

    if (record.type === "number") {
      bindings.push({
        key: record.key,
        label,
        source: "data_field",
        fieldKey: record.key,
      });
      continue;
    }

    if (record.type !== "table" || !Array.isArray(record.columns)) continue;

    for (const column of record.columns) {
      const tableColumn = toRecord(column);
      if (
        tableColumn.type !== "number" ||
        typeof tableColumn.key !== "string"
      ) {
        continue;
      }
      const columnLabel =
        typeof tableColumn.label === "string"
          ? tableColumn.label
          : tableColumn.key;

      bindings.push({
        key: `${record.key}_${tableColumn.key}`,
        label: `${label} / ${columnLabel}`,
        source: "table_column",
        fieldKey: record.key,
        columnKey: tableColumn.key,
        metadata: variableBindingPhaseMetadata(record, tableColumn),
      });

      for (const statistic of [
        "mean",
        "sample_stddev",
        "count",
        "min",
        "max",
      ] as const) {
        bindings.push({
          key: `${record.key}_${tableColumn.key}_${statistic}`,
          label: `${label} / ${columnLabel} / ${statistic}`,
          source: "table_statistic",
          fieldKey: record.key,
          columnKey: tableColumn.key,
          statistic,
          metadata: variableBindingPhaseMetadata(record, tableColumn),
        });
      }
    }
  }

  bindings.push(
    {
      key: "env_temperature",
      label: "Temperatura ambiente",
      source: "environment",
      field: "temperature",
    },
    {
      key: "env_humidity",
      label: "Umidade ambiente",
      source: "environment",
      field: "humidity",
    },
    {
      key: "env_pressure",
      label: "Pressão ambiente",
      source: "environment",
      field: "pressure",
    },
  );

  return bindings;
}

function variableBindingPhaseMetadata(
  field: Record<string, unknown>,
  column: Record<string, unknown>,
) {
  if (
    typeof field.phaseBlockKey !== "string" ||
    !field.phaseBlockKey.trim() ||
    (column.phase !== "before" && column.phase !== "after")
  ) {
    return undefined;
  }
  return {
    phaseBlock: field.phaseBlockKey.trim(),
    phase: column.phase,
  };
}

function buildStandardCompatibilityVariableBindings(
  rawFormulas: unknown[],
  rawValidations: unknown[],
): unknown[] {
  const expressions = [
    ...rawFormulas.flatMap((formula) => {
      const record = toRecord(formula);
      return typeof record.expression === "string" ? [record.expression] : [];
    }),
    ...rawValidations.flatMap((validation) => {
      const record = toRecord(validation);
      if (typeof record.expression === "string") return [record.expression];
      return [
        typeof record.leftExpression === "string"
          ? record.leftExpression
          : null,
        typeof record.rightExpression === "string"
          ? record.rightExpression
          : null,
      ].filter((item): item is string => typeof item === "string");
    }),
  ];
  const keys = new Set<string>();

  for (const expression of expressions) {
    for (const token of expression.match(/\bstd_\d+_[A-Za-z0-9_]+\b/g) ?? []) {
      keys.add(token);
    }
  }

  return [...keys].map((key) => {
    const match = key.match(/^std_(\d+)_(.+)$/);
    return {
      key,
      label: key,
      source: "standard",
      standardId: match ? Number(match[1]) : undefined,
      valueKey: match?.[2] ?? key,
    };
  });
}

function methodFormulaReportingToDefinitionReporting(reporting: unknown) {
  const record = toRecord(reporting);
  if (!reporting || typeof reporting !== "object") return undefined;
  const normalized = {
    ...(typeof record.includeInCertificate === "boolean"
      ? { includeInCertificate: record.includeInCertificate }
      : {}),
    ...(isFormulaReportingRole(record.role) ? { role: record.role } : {}),
    ...(isFormulaReportingGroup(record.group) ? { group: record.group } : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function methodVariableBindingToDefinitionInput(
  binding: unknown,
): MethodDraft["inputs"][number] | null {
  const record = toRecord(binding);
  if (typeof record.key !== "string") return null;

  return {
    kind: "scalar" as const,
    key: record.key,
    label:
      typeof record.label === "string" && record.label.trim()
        ? record.label
        : record.key,
    required: false,
    quantityKind: "other" as const,
    metadata: {
      source: "variable_binding",
      bindingSource: safeMetadataString(record.source),
      fieldKey: safeMetadataString(record.fieldKey),
      columnKey: safeMetadataString(record.columnKey),
      statistic: safeMetadataString(record.statistic),
      field: safeMetadataString(record.field),
      ...safeDefinitionMetadata(record.metadata),
      standardId:
        typeof record.standardId === "number" &&
        Number.isFinite(record.standardId)
          ? record.standardId
          : null,
      valueKey: safeMetadataString(record.valueKey),
    },
  };
}

function safeMetadataString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function safeDefinitionMetadata(
  value: unknown,
): Record<string, string | number | boolean | null> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const metadata: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item === "string" ||
      typeof item === "boolean" ||
      item === null ||
      (typeof item === "number" && Number.isFinite(item))
    ) {
      metadata[key] = item;
    }
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export function methodValidationToAcceptanceCriterion(
  validation: unknown,
  index: number,
) {
  const record = toRecord(validation);

  const expression =
    typeof record.expression === "string"
      ? record.expression
      : typeof record.leftExpression === "string" &&
          typeof record.operator === "string" &&
          typeof record.rightExpression === "string"
        ? `${record.leftExpression} ${record.operator} ${record.rightExpression}`
        : null;

  if (!expression) return null;

  return {
    key: `criterion_${index + 1}`,
    label:
      typeof record.message === "string"
        ? record.message
        : `Critério ${index + 1}`,
    expression,
    severity: record.severity === "warning" ? "warning" : "blocking",
    message:
      typeof record.message === "string"
        ? record.message
        : "Critério de aceitação",
    metadata: safeDefinitionMetadata(record.metadata),
  };
}

export function mapPersistedStatus(status: unknown): MethodDraft["status"] {
  switch (status) {
    case "PENDING_APPROVAL":
      return "ready_for_review";
    case "TECHNICAL_REVIEWED":
      return "under_review";
    case "PUBLISHED":
      return "published";
    case "ARCHIVED":
      return "archived";
    case "DRAFT":
    default:
      return "draft";
  }
}

export function safeMethodId(value: unknown): string {
  const text = String(value ?? "method_draft");
  const sanitized = text.replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[a-zA-Z]/.test(sanitized) ? sanitized : `method_${sanitized}`;
}

function methodStandardValueTargetColumnsToDefinition(
  value: unknown,
): DefinitionStandardValue["targetColumns"] {
  const record = toRecord(value);
  const normalized = {
    ...(typeof record.value === "string" ? { value: record.value } : {}),
    ...(typeof record.expandedUncertainty === "string"
      ? { expandedUncertainty: record.expandedUncertainty }
      : {}),
    ...(typeof record.coverageFactor === "string"
      ? { coverageFactor: record.coverageFactor }
      : {}),
    ...(typeof record.drift === "string" ? { drift: record.drift } : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function methodTableColumnStandardValueToDefinition(
  value: unknown,
): DefinitionTableColumn["standardValue"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = toRecord(value);
  const targetColumns =
    record.targetColumns &&
    typeof record.targetColumns === "object" &&
    !Array.isArray(record.targetColumns)
      ? methodStandardValueTargetColumnsToDefinition(record.targetColumns)
      : undefined;
  const normalized: DefinitionStandardValue = {
    ...(record.matchBy === "nominal" ? { matchBy: record.matchBy } : {}),
    ...(targetColumns ? { targetColumns } : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function isFormulaReportingRole(
  value: unknown,
): value is NonNullable<MethodDraft["formulas"][number]["reporting"]>["role"] {
  return FORMULA_REPORTING_ROLES.some((role) => role === value);
}

function isFormulaReportingGroup(
  value: unknown,
): value is NonNullable<MethodDraft["formulas"][number]["reporting"]>["group"] {
  return FORMULA_REPORTING_GROUPS.some((group) => group === value);
}
