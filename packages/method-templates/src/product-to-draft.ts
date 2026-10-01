import {
  parseMethodDraft,
  type MethodDraft,
  type MethodDraftStatus,
} from "@calibra-facil/method-definition";

import type { BuildDraftArgs } from "./types";
import { safeMethodId, stripUndefinedDeep } from "./util";

/**
 * Generic product-format → method-definition draft conversion, shared by every
 * template so each one authors a SINGLE (product) representation. The converter
 * functions were extracted verbatim from the original lab seed; the mass-balance
 * fingerprint test guards against any behavioural drift.
 */

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function safeMetadataString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function safeDefinitionMetadata(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const metadata: Record<string, unknown> = {};
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

function mapPersistedStatus(status: unknown): MethodDraftStatus {
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

function methodInputExecutionMetadata(
  record: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {};

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
      ]) {
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
          .filter((item) => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
          .join(",")
      : null;
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function methodMassCompositionTargetColumnsToDefinition(
  value: unknown,
): Record<string, unknown> {
  const record = objectRecord(value) ?? {};
  return {
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
    ...(typeof record.buoyancy === "string"
      ? { buoyancy: record.buoyancy }
      : {}),
    ...(typeof record.drift === "string" ? { drift: record.drift } : {}),
  };
}

function methodTableColumnMassCompositionToDefinition(
  value: unknown,
): Record<string, unknown> | undefined {
  const record = objectRecord(value);
  if (!record) return undefined;
  const targetColumns = objectRecord(record.targetColumns)
    ? methodMassCompositionTargetColumnsToDefinition(record.targetColumns)
    : undefined;
  const normalized: Record<string, unknown> = {
    ...(record.targetUnit === "mg" ||
    record.targetUnit === "g" ||
    record.targetUnit === "kg"
      ? { targetUnit: record.targetUnit }
      : {}),
    ...(record.optionSource === "reference_standards" ||
    record.optionSource === "composition_profiles"
      ? { optionSource: record.optionSource }
      : {}),
    ...(targetColumns ? { targetColumns } : {}),
    ...(record.uncertaintyMode === "expanded_rss"
      ? { uncertaintyMode: record.uncertaintyMode }
      : {}),
    ...(record.quantityMode === "linear_per_item_then_rss" ||
    record.quantityMode === "profile_linear"
      ? { quantityMode: record.quantityMode }
      : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function methodStandardValueTargetColumnsToDefinition(
  value: unknown,
): Record<string, unknown> | undefined {
  const record = objectRecord(value);
  if (!record) return undefined;
  const normalized: Record<string, unknown> = {
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
): Record<string, unknown> | undefined {
  const record = objectRecord(value);
  if (!record) return undefined;
  const targetColumns = objectRecord(record.targetColumns)
    ? methodStandardValueTargetColumnsToDefinition(record.targetColumns)
    : undefined;
  const normalized: Record<string, unknown> = {
    ...(record.matchBy === "nominal" ? { matchBy: record.matchBy } : {}),
    ...(targetColumns ? { targetColumns } : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function methodInputToDefinitionInput(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const record = input;
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
      quantityKind: "other",
      ...(metadata ? { metadata } : {}),
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
              if (
                !column ||
                typeof column.key !== "string" ||
                typeof column.label !== "string"
              ) {
                return null;
              }
              return {
                key: column.key,
                label: column.label,
                type: column.type === "number" ? "number" : "text",
                unit: typeof column.unit === "string" ? column.unit : undefined,
                role:
                  column.role === "standard_value" ||
                  column.role === "mass_standard_composition"
                    ? column.role
                    : undefined,
                phase:
                  column.phase === "before" ||
                  column.phase === "after" ||
                  column.phase === "always"
                    ? column.phase
                    : undefined,
                massComposition: methodTableColumnMassCompositionToDefinition(
                  column.massComposition,
                ),
                standardValue: methodTableColumnStandardValueToDefinition(
                  column.standardValue,
                ),
              };
            })
            .filter(Boolean)
        : [],
    };
  }

  return {
    kind: "text",
    key,
    label,
    required,
  };
}

function methodFormulaScopeToDefinitionScope(
  scope: unknown,
): Record<string, unknown> | undefined {
  const record = objectRecord(scope);
  if (!record) return undefined;
  if (record.kind === "scalar") return { kind: "scalar" };
  if (record.kind === "table_row" && typeof record.tableKey === "string") {
    return { kind: "table_row", tableKey: record.tableKey };
  }
  return undefined;
}

function isFormulaReportingRole(value: unknown): boolean {
  return (
    typeof value === "string" &&
    [
      "primary_result",
      "expanded_uncertainty",
      "coverage_factor",
      "conformity_margin",
      "uncertainty_component",
      "auxiliary",
    ].includes(value)
  );
}

function isFormulaReportingGroup(value: unknown): boolean {
  return (
    typeof value === "string" &&
    ["calibration_result", "uncertainty_budget", "raw_calculation"].includes(
      value,
    )
  );
}

function methodFormulaReportingToDefinitionReporting(
  reporting: unknown,
): Record<string, unknown> | undefined {
  const record = objectRecord(reporting);
  if (!record) return undefined;
  const normalized: Record<string, unknown> = {
    ...(typeof record.includeInCertificate === "boolean"
      ? { includeInCertificate: record.includeInCertificate }
      : {}),
    ...(isFormulaReportingRole(record.role) ? { role: record.role } : {}),
    ...(isFormulaReportingGroup(record.group) ? { group: record.group } : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function methodFormulaToDefinitionFormula(
  formula: Record<string, unknown>,
): Record<string, unknown> {
  return {
    key:
      typeof formula.outputKey === "string"
        ? formula.outputKey
        : typeof formula.key === "string"
          ? formula.key
          : "formula",
    label:
      typeof formula.label === "string"
        ? formula.label
        : typeof formula.outputKey === "string"
          ? formula.outputKey
          : "formula",
    expression:
      typeof formula.expression === "string" ? formula.expression : "0",
    outputUnit:
      typeof formula.unit === "string"
        ? formula.unit
        : typeof formula.outputUnit === "string"
          ? formula.outputUnit
          : undefined,
    outputKind: "derived_quantity",
    required: true,
    reporting: methodFormulaReportingToDefinitionReporting(formula.reporting),
    scope: methodFormulaScopeToDefinitionScope(formula.scope),
    metadata: safeDefinitionMetadata(formula.metadata),
  };
}

function variableBindingPhaseMetadata(
  field: Record<string, unknown>,
  column: unknown,
): Record<string, unknown> | undefined {
  const col = objectRecord(column);
  const phase = col?.phase;
  if (
    typeof field.phaseBlockKey !== "string" ||
    !field.phaseBlockKey.trim() ||
    (phase !== "before" && phase !== "after")
  ) {
    return undefined;
  }
  return {
    phaseBlock: field.phaseBlockKey.trim(),
    phase,
  };
}

function buildDefaultVariableBindings(
  rawInputs: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  const bindings: Record<string, unknown>[] = [];

  for (const input of rawInputs) {
    if (!input || typeof input.key !== "string") continue;
    const label = typeof input.label === "string" ? input.label : input.key;

    if (input.type === "number") {
      bindings.push({
        key: input.key,
        label,
        source: "data_field",
        fieldKey: input.key,
      });
      continue;
    }

    if (input.type !== "table" || !Array.isArray(input.columns)) continue;
    for (const column of input.columns) {
      if (column?.type !== "number" || typeof column.key !== "string") {
        continue;
      }
      const columnLabel =
        typeof column.label === "string" ? column.label : column.key;
      bindings.push({
        key: `${input.key}_${column.key}`,
        label: `${label} / ${columnLabel}`,
        source: "table_column",
        fieldKey: input.key,
        columnKey: column.key,
        metadata: variableBindingPhaseMetadata(input, column),
      });
      for (const statistic of [
        "mean",
        "sample_stddev",
        "count",
        "min",
        "max",
      ]) {
        bindings.push({
          key: `${input.key}_${column.key}_${statistic}`,
          label: `${label} / ${columnLabel} / ${statistic}`,
          source: "table_statistic",
          fieldKey: input.key,
          columnKey: column.key,
          statistic,
          metadata: variableBindingPhaseMetadata(input, column),
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

function methodVariableBindingToDefinitionInput(
  binding: unknown,
): Record<string, unknown> | null {
  const record = objectRecord(binding);
  if (!record || typeof record.key !== "string") return null;
  return {
    kind: "scalar",
    key: record.key,
    label:
      typeof record.label === "string" && record.label.trim()
        ? record.label
        : record.key,
    required: false,
    quantityKind: "other",
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

function methodValidationToAcceptanceCriterion(
  validation: unknown,
  index: number,
): Record<string, unknown> {
  const record = objectRecord(validation) ?? {};
  const expression =
    typeof record.expression === "string"
      ? record.expression
      : typeof record.leftExpression === "string" &&
          typeof record.operator === "string" &&
          typeof record.rightExpression === "string"
        ? `${record.leftExpression} ${record.operator} ${record.rightExpression}`
        : null;

  return {
    key: `criterion_${index + 1}`,
    label:
      typeof record.message === "string"
        ? record.message
        : `Critério ${index + 1}`,
    expression: expression ?? "true == true",
    severity: record.severity === "warning" ? "warning" : "blocking",
    message:
      typeof record.message === "string"
        ? record.message
        : "Critério de aceitação",
    metadata: safeDefinitionMetadata(record.metadata),
  };
}

/**
 * Faithful port of the seed's `buildDefinitionDraft`. Produces the same draft
 * (and therefore the same fingerprint) the seed compiles. `methodId`/`version`
 * are fingerprint inputs; `status` is stripped before fingerprinting.
 */

export type ProductDraftSource = {
  name: string;
  description?: string;
  assetTypeId?: string;
  dataFields: readonly Record<string, unknown>[];
  formulas: readonly Record<string, unknown>[];
  // GUM measurement models, already in method-definition shape — passed through,
  // not converted. Defaults to [] for templates using formula-based uncertainty
  // (mass-balance, force, …), so their drafts (and fingerprints) are unchanged.
  measurementModels?: readonly Record<string, unknown>[];
  validations?: readonly unknown[];
  metadata: Record<string, unknown>;
};

/**
 * Build a compilable method-definition draft from a template's product-format
 * definition (data fields, formulas, validations). Mirrors the seed's original
 * buildDefinitionDraft, generalized over its inputs.
 */
export function buildDraftFromProduct(
  source: ProductDraftSource,
  args: BuildDraftArgs = {},
): MethodDraft {
  const { methodId, version, status } = args;
  const definitionInputs: Record<string, unknown>[] = [];
  const seenInputKeys = new Set<string>();

  for (const input of source.dataFields.map(methodInputToDefinitionInput)) {
    const key = input.key;
    if (typeof key !== "string") continue;
    definitionInputs.push(input);
    seenInputKeys.add(key);
  }

  for (const binding of buildDefaultVariableBindings(source.dataFields)) {
    const input = methodVariableBindingToDefinitionInput(binding);
    if (!input) continue;
    const key = input.key;
    if (typeof key !== "string" || seenInputKeys.has(key)) continue;
    definitionInputs.push(input);
    seenInputKeys.add(key);
  }

  return parseMethodDraft(
    stripUndefinedDeep({
      id: safeMethodId(methodId ?? source.name),
      version: version ?? 1,
      status: mapPersistedStatus(status),
      name: source.name,
      description: source.description,
      assetTypeId: source.assetTypeId,
      inputs: definitionInputs,
      formulas: source.formulas.map(methodFormulaToDefinitionFormula),
      measurementModels: source.measurementModels ?? [],
      acceptanceCriteria: (source.validations ?? []).map(
        methodValidationToAcceptanceCriterion,
      ),
      previewScenarios: [],
      metadata: source.metadata,
    }),
  );
}
