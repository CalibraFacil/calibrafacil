import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import {
  calibrationMethod,
  methodAuditLog,
  assetType,
  user,
} from "@calibra-facil/db/schema";
import {
  CreateMethodSchema,
  UpdateMethodSchema,
  FromTemplateSchema,
  ListMethodsQuerySchema,
  ReturnMethodToDraftSchema,
  normalizeMethodValidationsInput,
} from "@calibra-facil/schemas";
import { listTemplates } from "@calibra-facil/method-templates";
import {
  compileMethodDraft,
  checkMethodRecordDimensions,
  checkMethodDraftDimensions,
  errorDiagnostic,
  fingerprintJson,
  canonicalJson,
  parseMethodDraft,
  type CalculationEngineLike,
  type CompiledMethod,
  type DimensionalDiagnostic,
  type MethodDraft,
  type MethodDiagnostic,
  type MethodPreviewResult,
} from "@calibra-facil/method-definition";
import {
  createCalculationEngine,
  normalizeEngineOptions,
} from "@calibra-facil/math-engine";
import { eq, and, ilike, or, count, desc, ne } from "drizzle-orm";
import {
  withLabPermission,
  type AuthVariables,
  requireRole,
} from "../middleware/permission";
import { requireFeature } from "../middleware/tier-guard";
import { alias } from "drizzle-orm/pg-core";
import {
  buildMethodRouteIdentifier,
  parseNumericRouteIdentifier,
} from "../lib/route-identifiers";

const technicalReviewerUser = alias(user, "technicalReviewerUser");
const approverUser = alias(user, "approverUser");

const METHOD_ENGINE_OPTIONS = {
  numericMode: "decimal" as const,
  rejectUnusedInputs: true,
  maxExponentMagnitude: 12,
  maxSignificantDigits: 24,
};

type DefinitionTableColumn = Extract<
  MethodDraft["inputs"][number],
  { kind: "table" }
>["columns"][number];
type DefinitionMassComposition = NonNullable<
  DefinitionTableColumn["massComposition"]
>;

function compileDraftWithEngine(
  draft: MethodDraft,
  options: {
    requirePublishable?: boolean;
    previewScenarios?: MethodDraft["previewScenarios"];
    includePreviewScenariosInFingerprint?: boolean;
  } = {},
) {
  const normalizedOptions = normalizeEngineOptions(METHOD_ENGINE_OPTIONS);
  // oxlint-disable-next-line typescript/consistent-type-assertions -- math-engine v0.3.0 has narrower input parameter types than method-definition's adapter interface, but the runtime method surface is compatible.
  const engine = createCalculationEngine(
    METHOD_ENGINE_OPTIONS,
  ) as unknown as CalculationEngineLike;

  return compileMethodDraft(draft, {
    engine,
    engineMetadata: {
      packageName: "@calibra-facil/math-engine",
      version: normalizedOptions.engineVersion,
      optionsFingerprint: fingerprintJson(normalizedOptions, "engine-options"),
    },
    requirePublishable: options.requirePublishable,
    previewScenarios: options.previewScenarios,
    includePreviewScenariosInFingerprint:
      options.includePreviewScenariosInFingerprint,
  });
}

function normalizeMethodRecord<
  T extends {
    validations?: unknown;
    variableBindings?: unknown;
    measurementModels?: unknown;
  },
>(method: T) {
  return {
    ...method,
    variableBindings: Array.isArray(method.variableBindings)
      ? method.variableBindings
      : [],
    measurementModels: Array.isArray(method.measurementModels)
      ? method.measurementModels
      : [],
    validations: normalizeMethodValidationsInput(method.validations),
  };
}

function methodCompileResponse(result: ReturnType<typeof compileMethodDraft>) {
  if (!result.ok) {
    return {
      ok: false,
      diagnostics: result.diagnostics,
      fingerprint: null,
      normalizedFormulas: [],
      compiledMethod: null,
    };
  }

  return {
    ok: true,
    diagnostics: result.diagnostics,
    fingerprint: result.method.methodFingerprint,
    normalizedFormulas: result.method.formulas.map((formula) => ({
      outputKey: formula.key,
      expression: formula.expression,
      normalizedExpression: formula.normalizedFormula,
      formulaFingerprint: formula.formulaFingerprint,
      variables: formula.variables,
      scope: formula.scope ?? { kind: "scalar" },
    })),
    previewResults: result.previewResults,
    compiledMethod: result.method,
  };
}

function buildPublicationEvidence(params: {
  methodId: number;
  version: number;
  compiledMethod: CompiledMethod;
  previewScenarios?: MethodDraft["previewScenarios"];
  previewResults: MethodPreviewResult[];
  diagnostics: MethodDiagnostic[];
  reviewedBy?: string | null;
  publishedBy: string;
  reasonForChange?: string | null;
  certificateContent: unknown;
  uncertaintyParams: unknown;
  measurementModels: unknown;
}) {
  const evidenceBase = {
    methodId: String(params.methodId),
    version: params.version,
    methodFingerprint: params.compiledMethod.methodFingerprint,
    normalizedMethodJson: params.compiledMethod.normalizedMethodJson,
    engineVersion: params.compiledMethod.engine.version,
    engineOptionsFingerprint: params.compiledMethod.engine.optionsFingerprint,
    compiledAt: new Date().toISOString(),
    reviewedBy: params.reviewedBy ?? null,
    publishedBy: params.publishedBy,
    reasonForChange: params.reasonForChange ?? null,
    previewScenarios: params.previewScenarios ?? [],
    previewResults: params.previewResults,
    diagnostics: params.diagnostics,
    certificateContent: params.certificateContent ?? null,
    uncertaintyParams: params.uncertaintyParams ?? [],
    measurementModels: params.measurementModels ?? [],
  };
  return {
    ...evidenceBase,
    publicationFingerprint: fingerprintJson(
      {
        compiledMethod: params.compiledMethod,
        certificateContent: evidenceBase.certificateContent,
        uncertaintyParams: evidenceBase.uncertaintyParams,
        measurementModels: evidenceBase.measurementModels,
        previewScenarios: evidenceBase.previewScenarios,
        previewResults: params.previewResults,
      },
      "publication",
    ),
    publicationEvidenceJson: canonicalJson(evidenceBase),
  };
}

function unmodeledUncertaintyDiagnostics(params: {
  uncertaintyParams: unknown;
  compiledMethod: CompiledMethod;
}): MethodDiagnostic[] {
  if (
    !Array.isArray(params.uncertaintyParams) ||
    params.uncertaintyParams.length === 0 ||
    params.compiledMethod.measurementModels.length > 0
  ) {
    return [];
  }

  return [
    {
      code: "UNCERTAINTY_PARAMS_NOT_GUM_MODELED",
      severity: "error",
      path: "uncertaintyParams",
      message:
        "Parâmetros de incerteza Type B estão configurados, mas nenhum modelo GUM compilado foi definido para publicação.",
      details: {
        componentCount: params.uncertaintyParams.length,
      },
    },
  ];
}

function coerceMethodDraft(value: unknown): MethodDraft {
  const candidate = recordFromUnknown(value);

  if (
    typeof candidate.id === "string" &&
    typeof candidate.status === "string" &&
    Array.isArray(candidate.measurementModels) &&
    Array.isArray(candidate.acceptanceCriteria) &&
    Array.isArray(candidate.previewScenarios)
  ) {
    return parseMethodDraft(candidate);
  }

  return methodPayloadToDefinitionDraft(candidate);
}

function tryCoerceMethodDraft(
  value: unknown,
):
  | { ok: true; draft: MethodDraft }
  | { ok: false; diagnostics: MethodDiagnostic[] } {
  try {
    return { ok: true, draft: coerceMethodDraft(value) };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "METHOD_SHAPE_INVALID",
          severity: "error",
          message:
            error instanceof Error ? error.message : "Invalid method draft",
          path: "draft",
        },
      ],
    };
  }
}

function methodPayloadToDefinitionDraft(
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

function methodInputToDefinitionInput(
  input: unknown,
): MethodDraft["inputs"][number] {
  const record = recordFromUnknown(input);
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
              const tableColumn = recordFromUnknown(column);
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

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return objectRecord(value) ?? {};
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
  const record = recordFromUnknown(value);
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
  const record = recordFromUnknown(value);
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

// BUGFIX (surfaced while writing DOM-10 deny tests, unrelated to the
// dimensional gate itself — see slice-3 report): this function used to set
// `outputUnit` / `reporting` / `scope` / `metadata` unconditionally, which put
// an EXPLICIT `undefined` value on the returned object whenever a formula
// lacked that optional field. `parseMethodDraft` → `assertSafeUnknown` rejects
// any object key whose value is literally `undefined` (vs. the key being
// absent), so `methodRecordToDraft` — used by request-approval, quality-approve
// and publish — 500'd for ANY stored method with a formula missing
// unit/reporting/scope/metadata (i.e. most real formulas). Conditional-spread
// each optional field instead, mirroring `methodInputToDefinitionInput`'s
// existing `...(metadata ? { metadata } : {})` convention above.
function methodFormulaToDefinitionFormula(formula: unknown) {
  const record = recordFromUnknown(formula);
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
  const record = recordFromUnknown(scope);
  if (record.kind === "scalar") return { kind: "scalar" as const };
  if (record.kind === "table_row" && typeof record.tableKey === "string") {
    return { kind: "table_row" as const, tableKey: record.tableKey };
  }
  return undefined;
}

function buildDefaultVariableBindings(rawInputs: unknown[]): unknown[] {
  const bindings: Array<Record<string, unknown>> = [];

  for (const input of rawInputs) {
    const record = recordFromUnknown(input);
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
      const tableColumn = recordFromUnknown(column);
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
      const record = recordFromUnknown(formula);
      return typeof record.expression === "string" ? [record.expression] : [];
    }),
    ...rawValidations.flatMap((validation) => {
      const record = recordFromUnknown(validation);
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
  const record = recordFromUnknown(reporting);
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

function isFormulaReportingRole(
  value: unknown,
): value is NonNullable<MethodDraft["formulas"][number]["reporting"]>["role"] {
  return (
    value === "primary_result" ||
    value === "expanded_uncertainty" ||
    value === "coverage_factor" ||
    value === "conformity_margin" ||
    value === "uncertainty_component" ||
    value === "auxiliary"
  );
}

function isFormulaReportingGroup(
  value: unknown,
): value is NonNullable<MethodDraft["formulas"][number]["reporting"]>["group"] {
  return (
    value === "calibration_result" ||
    value === "uncertainty_budget" ||
    value === "raw_calculation"
  );
}

function methodVariableBindingToDefinitionInput(
  binding: unknown,
): MethodDraft["inputs"][number] | null {
  const record = recordFromUnknown(binding);
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

function methodValidationToAcceptanceCriterion(
  validation: unknown,
  index: number,
) {
  const record = recordFromUnknown(validation);

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

function mapPersistedStatus(status: unknown): MethodDraft["status"] {
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

function safeMethodId(value: unknown): string {
  const text = String(value ?? "method_draft");
  const sanitized = text.replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[a-zA-Z]/.test(sanitized) ? sanitized : `method_${sanitized}`;
}

function methodRecordToDraft(method: {
  id: number;
  version: number;
  status?: string | null;
  name: string;
  description: string | null;
  assetTypeId: number | null;
  dataFields: unknown;
  variableBindings?: unknown;
  formulas: unknown;
  measurementModels?: unknown;
  validations: unknown;
}): MethodDraft {
  return coerceMethodDraft({
    id: method.id,
    version: method.version,
    name: method.name,
    description: method.description ?? undefined,
    assetTypeId: method.assetTypeId ?? undefined,
    status: method.status ?? undefined,
    dataFields: method.dataFields,
    variableBindings: method.variableBindings,
    formulas: method.formulas,
    measurementModels: method.measurementModels,
    validations: method.validations,
  });
}

function diagnosticsMessage(diagnostics: MethodDiagnostic[]): string {
  return (
    diagnostics.find((item) => item.severity === "error")?.message ??
    "Método não compilou"
  );
}

/**
 * DOM-10 dimensional publish gate. Runs the publish-time dimensional lint over a
 * raw method shape (dataFields / formulas / measurementModels) and, when it
 * finds a dimensional incoherence, returns a structured pt-BR error carrying the
 * named `DIMENSIONAL_ERROR` code plus a per-formula diagnostics array. Returns
 * `null` when the method is dimensionally coherent (or has nothing to check).
 *
 * The response mirrors the existing compile-failure shape ({ error, diagnostics }
 * at HTTP 422) so the frontend handles a dimensional rejection identically — it
 * only adds the `code` discriminator and the formatted-dimension messages.
 */
function formatDimensionalDiagnostic(d: DimensionalDiagnostic): string {
  return `Erro dimensional na fórmula '${d.formulaId}': ${d.message}`;
}

function dimensionalErrorPayload(diagnostics: readonly DimensionalDiagnostic[]) {
  const first = diagnostics[0];
  return {
    error: first
      ? formatDimensionalDiagnostic(first)
      : "Erro dimensional no método",
    code: "DIMENSIONAL_ERROR" as const,
    diagnostics: diagnostics.map((d) => ({
      formulaId: d.formulaId,
      code: d.code,
      message: formatDimensionalDiagnostic(d),
    })),
  };
}

function dimensionalGateError(shape: {
  dataFields?: unknown;
  variableBindings?: unknown;
  formulas?: unknown;
  measurementModels?: unknown;
}): ReturnType<typeof dimensionalErrorPayload> | null {
  const diagnostics = checkMethodRecordDimensions(shape);
  return diagnostics.length > 0 ? dimensionalErrorPayload(diagnostics) : null;
}

/**
 * Map the dimensional diagnostics of a compiled draft to error-severity
 * {@link MethodDiagnostic}s so the live Method Builder compile/preview panel
 * (`compile-preview-panel.tsx`, which already lists `diagnostics[]` per formula)
 * surfaces them — no new UI, and a no-op for dimensionally coherent drafts.
 */
function dimensionalMethodDiagnostics(draft: MethodDraft): MethodDiagnostic[] {
  return checkMethodDraftDimensions(draft).map((d) =>
    errorDiagnostic(
      "DIMENSIONAL_ERROR",
      formatDimensionalDiagnostic(d),
      d.formulaId,
    ),
  );
}

/**
 * Append dimensional diagnostics to a compile response (and force `ok: false`
 * when present) so the editor treats a dimensional incoherence as a hard error
 * BEFORE save. Byte-identical to the input response when the draft is coherent.
 */
function augmentCompileResponseWithDimensions(
  response: ReturnType<typeof methodCompileResponse>,
  draft: MethodDraft,
): ReturnType<typeof methodCompileResponse> {
  const dimensional = dimensionalMethodDiagnostics(draft);
  if (dimensional.length === 0) return response;
  return {
    ...response,
    ok: false,
    diagnostics: [...response.diagnostics, ...dimensional],
  };
}

function buildAdhocPreviewScenarios(
  sampleData: Record<string, unknown> | undefined,
): MethodDraft["previewScenarios"] | undefined {
  if (!sampleData) return undefined;
  return [
    {
      key: "publish_preview",
      label: "Preview de publicação",
      inputs: sampleData,
    },
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildReviewPreviewEvidence(params: {
  compiledMethod: CompiledMethod;
  previewScenarios: MethodDraft["previewScenarios"] | undefined;
  previewResults: MethodPreviewResult[];
  diagnostics: MethodDiagnostic[];
  compiledBy: string;
}) {
  const evidenceBase = {
    kind: "review_preview",
    methodFingerprint: params.compiledMethod.methodFingerprint,
    normalizedMethodJson: params.compiledMethod.normalizedMethodJson,
    engineVersion: params.compiledMethod.engine.version,
    engineOptionsFingerprint: params.compiledMethod.engine.optionsFingerprint,
    compiledAt: new Date().toISOString(),
    compiledBy: params.compiledBy,
    previewScenarios: params.previewScenarios ?? [],
    previewResults: params.previewResults,
    diagnostics: params.diagnostics,
  };

  return {
    ...evidenceBase,
    reviewPreviewFingerprint: fingerprintJson(evidenceBase, "review-preview"),
  };
}

function reviewPreviewScenariosFromEvidence(
  evidence: unknown,
  methodFingerprint: string | null | undefined,
): MethodDraft["previewScenarios"] | undefined {
  if (!isRecord(evidence) || evidence.kind !== "review_preview") {
    return undefined;
  }
  if (
    typeof methodFingerprint !== "string" ||
    evidence.methodFingerprint !== methodFingerprint
  ) {
    return undefined;
  }
  if (!Array.isArray(evidence.previewScenarios)) {
    return undefined;
  }

  return evidence.previewScenarios.filter(isMethodPreviewScenario);
}

function isMethodPreviewScenario(
  value: unknown,
): value is MethodDraft["previewScenarios"][number] {
  const scenario = recordFromUnknown(value);
  return (
    typeof scenario.key === "string" &&
    typeof scenario.label === "string" &&
    objectRecord(scenario.inputs) !== null
  );
}

function scalarResultValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function resolvePublicationPreviewScenarios(
  sampleData: Record<string, unknown> | undefined,
  evidence: unknown,
  methodFingerprint: string | null | undefined,
): MethodDraft["previewScenarios"] | undefined {
  return (
    buildAdhocPreviewScenarios(sampleData) ??
    reviewPreviewScenariosFromEvidence(evidence, methodFingerprint)
  );
}

async function resolveMethodRouteId(
  identifier: string,
  organizationId: string,
): Promise<number | null> {
  const numericRouteId = parseNumericRouteIdentifier(identifier);

  if (numericRouteId) {
    const [method] = await db
      .select({ id: calibrationMethod.id })
      .from(calibrationMethod)
      .where(
        and(
          eq(calibrationMethod.id, numericRouteId),
          eq(calibrationMethod.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (method) return method.id;
  }

  const methods = await db
    .select({
      id: calibrationMethod.id,
      name: calibrationMethod.name,
      version: calibrationMethod.version,
    })
    .from(calibrationMethod)
    .where(eq(calibrationMethod.organizationId, organizationId));

  return (
    methods.find((method) => buildMethodRouteIdentifier(method) === identifier)
      ?.id ?? null
  );
}

export const methodsRouter = new Hono<{ Variables: AuthVariables }>()
  // =========================================================================
  // GET / - List methods with filtering and pagination
  // =========================================================================
  .get(
    "/",
    ...withLabPermission({ template: ["read"] }),
    zValidator("query", ListMethodsQuerySchema),
    async (c) => {
      const member = c.get("member");
      const { page, limit, status, assetTypeId, query, includeArchived } =
        c.req.valid("query");
      const offset = (page - 1) * limit;

      try {
        // Build where conditions
        const conditions = [
          eq(calibrationMethod.organizationId, member.organizationId),
        ];

        if (status) {
          conditions.push(eq(calibrationMethod.status, status));
        } else if (!includeArchived) {
          conditions.push(ne(calibrationMethod.status, "ARCHIVED"));
        }

        if (assetTypeId) {
          conditions.push(eq(calibrationMethod.assetTypeId, assetTypeId));
        }

        if (query) {
          conditions.push(
            or(
              ilike(calibrationMethod.name, `%${query}%`),
              ilike(calibrationMethod.description, `%${query}%`),
            )!,
          );
        }

        const whereCondition = and(...conditions);

        // Get total count
        const [countResult] = await db
          .select({ total: count() })
          .from(calibrationMethod)
          .where(whereCondition);

        const total = countResult?.total ?? 0;

        // Get methods with related data
        const methods = await db
          .select({
            id: calibrationMethod.id,
            name: calibrationMethod.name,
            description: calibrationMethod.description,
            version: calibrationMethod.version,
            status: calibrationMethod.status,
            assetTypeId: calibrationMethod.assetTypeId,
            assetTypeName: assetType.name,
            dataFields: calibrationMethod.dataFields,
            variableBindings: calibrationMethod.variableBindings,
            formulas: calibrationMethod.formulas,
            measurementModels: calibrationMethod.measurementModels,
            validations: calibrationMethod.validations,
            certificateContent: calibrationMethod.certificateContent,
            accreditedScope: calibrationMethod.accreditedScope,
            methodFingerprint: calibrationMethod.methodFingerprint,
            methodEngine: calibrationMethod.methodEngine,
            methodCompiledAt: calibrationMethod.methodCompiledAt,
            createdAt: calibrationMethod.createdAt,
            publishedAt: calibrationMethod.publishedAt,
            parentId: calibrationMethod.parentId,
          })
          .from(calibrationMethod)
          .leftJoin(assetType, eq(calibrationMethod.assetTypeId, assetType.id))
          .where(whereCondition)
          .orderBy(desc(calibrationMethod.createdAt))
          .limit(limit)
          .offset(offset);

        return c.json({
          data: methods.map(normalizeMethodRecord),
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        });
      } catch (error) {
        console.error("Error listing methods:", error);
        return c.json({ error: "Erro ao listar métodos" }, 500);
      }
    },
  )

  // =========================================================================
  // POST /compile - Compile a Method Builder draft without persistence
  // =========================================================================
  .post("/compile", ...withLabPermission({ template: ["read"] }), async (c) => {
    try {
      const body = recordFromUnknown(await c.req.json().catch(() => ({})));
      const draftResult = tryCoerceMethodDraft(
        body.draft ?? body.method ?? body,
      );
      if (!draftResult.ok) {
        return c.json(
          {
            ok: false,
            diagnostics: draftResult.diagnostics,
            fingerprint: null,
            normalizedFormulas: [],
            compiledMethod: null,
          },
          422,
        );
      }
      const result = compileDraftWithEngine(draftResult.draft);

      const response = augmentCompileResponseWithDimensions(
        methodCompileResponse(result),
        draftResult.draft,
      );
      return c.json(response, response.ok ? 200 : 422);
    } catch (error) {
      console.error("Error compiling method draft:", error);
      return c.json({ error: "Erro ao compilar rascunho do método" }, 500);
    }
  })

  // =========================================================================
  // POST /preview - Compile and run an ad-hoc Method Builder preview
  // =========================================================================
  .post("/preview", ...withLabPermission({ template: ["read"] }), async (c) => {
    try {
      const body = recordFromUnknown(await c.req.json().catch(() => ({})));
      const draftResult = tryCoerceMethodDraft(
        body.draft ?? body.method ?? body,
      );
      if (!draftResult.ok) {
        return c.json(
          {
            ok: false,
            diagnostics: draftResult.diagnostics,
            fingerprint: null,
            normalizedFormulas: [],
            compiledMethod: null,
          },
          422,
        );
      }
      const result = compileDraftWithEngine(draftResult.draft, {
        previewScenarios: [
          {
            key: "adhoc_preview",
            label: "Preview",
            inputs:
              objectRecord(body.sampleData) ?? objectRecord(body.inputs) ?? {},
          },
        ],
        includePreviewScenariosInFingerprint: false,
      });

      if (!result.ok) {
        return c.json(
          augmentCompileResponseWithDimensions(
            methodCompileResponse(result),
            draftResult.draft,
          ),
          422,
        );
      }

      const preview = result.previewResults[0];
      const dimensional = dimensionalMethodDiagnostics(draftResult.draft);
      return c.json({
        ok: (preview?.passed ?? false) && dimensional.length === 0,
        diagnostics: [
          ...result.diagnostics,
          ...(preview?.diagnostics ?? []),
          ...dimensional,
        ],
        fingerprint: result.method.methodFingerprint,
        previewResults: result.previewResults,
        results: Object.fromEntries([
          ...result.method.formulas.map((formula) => {
            const formulaResult = preview?.formulaResults.find(
              (item) => item.key === formula.key,
            );
            return [formula.key, formulaResult?.value ?? null] as const;
          }),
          ...result.method.measurementModels.map((model) => {
            const modelResult = preview?.measurementModelResults.find(
              (item) => item.key === model.key,
            );
            const resultRecord = recordFromUnknown(modelResult?.result);
            const value = modelResult
              ? Array.isArray(modelResult.result)
                ? modelResult.result.map((item) => item.value)
                : scalarResultValue(resultRecord.value)
              : null;
            return [model.key, value] as const;
          }),
        ]),
      });
    } catch (error) {
      console.error("Error previewing method draft:", error);
      return c.json({ error: "Erro ao executar preview do método" }, 500);
    }
  })

  // =========================================================================
  // GET /templates - Curated method-template catalog. Serves ONLY templates
  // whose governance is complete (sources/measurand/verificar/reviewStatus), so
  // the picker never renders a bare, context-less "trust-me" card. Registered
  // before "/:id" so the literal segment isn't captured as an id.
  // =========================================================================
  .get("/templates", ...withLabPermission({ template: ["read"] }), (c) => {
    const entries = listTemplates().flatMap(
      (
        template,
      ): ReadonlyArray<{
        templateKey: string;
        templateVersion: number;
        discipline: string;
        defaultName: string;
        defaultAccreditedScope: boolean;
        assetTypeSlug: string | undefined;
        description: string;
        model: "formulas" | "gum_measurement_model";
        counts: {
          dataFields: number;
          formulas: number;
          validations: number;
          uncertaintyParams: number;
          verificar: number;
          omitted: number;
        };
        // Served verbatim, but typed opaque here so the Hono app's inferred RPC
        // type stays under the tsgo serialization limit; the client consumes its
        // own MethodTemplateCatalogEntry DTO, not this inferred type.
        governance: unknown;
        spec: unknown;
        previewScenarios: unknown;
      }> => {
      const governance = template.governance;
      if (
        governance === undefined ||
        governance.sources.length === 0 ||
        governance.measurand.trim().length === 0 ||
        governance.verificarItems.length === 0 ||
        governance.reviewStatus !== "draft_pending_revalidation"
      ) {
        return [];
      }
      const def = template.productDefinition;
      return [
        {
          templateKey: template.key,
          templateVersion: template.templateVersion,
          discipline: template.discipline,
          defaultName: template.defaultName,
          defaultAccreditedScope: template.defaultAccreditedScope,
          assetTypeSlug: def.assetTypeSlug,
          description: def.description ?? "",
          model: governance.model,
          counts: {
            dataFields: def.dataFields.length,
            formulas: def.formulas.length,
            validations: def.validations.length,
            uncertaintyParams: def.uncertaintyParams.length,
            verificar: governance.verificarItems.length,
            omitted: governance.omittedComponents.length,
          },
          // Served verbatim: the picker's "informed, not trust-me" surface.
          governance,
          spec: {
            dataFields: def.dataFields,
            formulas: def.formulas,
            measurementModels: def.measurementModels,
            validations: def.validations,
            uncertaintyParams: def.uncertaintyParams,
            certificateContent: def.certificateContent,
          },
          previewScenarios: template.previewScenarios,
        },
      ];
    });

    return c.json(entries);
  })

  // =========================================================================
  // GET /:id/label - Get method label by ID
  // =========================================================================
  .get(
    "/:id/label",
    ...withLabPermission({ template: ["read"] }),
    async (c) => {
      const member = c.get("member");
      const id = await resolveMethodRouteId(
        c.req.param("id"),
        member.organizationId,
      );

      if (id === null) {
        return c.json({ error: "Método nao encontrado" }, 404);
      }

      const [method] = await db
        .select({
          id: calibrationMethod.id,
          label: calibrationMethod.name,
        })
        .from(calibrationMethod)
        .where(
          and(
            eq(calibrationMethod.id, id),
            eq(calibrationMethod.organizationId, member.organizationId),
          ),
        )
        .limit(1);

      if (!method) {
        return c.json({ error: "Método nao encontrado" }, 404);
      }

      return c.json(method);
    },
  )

  // =========================================================================
  // GET /:id - Get a single method by ID
  // =========================================================================
  .get("/:id", ...withLabPermission({ template: ["read"] }), async (c) => {
    const member = c.get("member");
    const id = await resolveMethodRouteId(
      c.req.param("id"),
      member.organizationId,
    );

    if (id === null) {
      return c.json({ error: "Método nao encontrado" }, 404);
    }

    try {
      const [method] = await db
        .select({
          id: calibrationMethod.id,
          organizationId: calibrationMethod.organizationId,
          name: calibrationMethod.name,
          description: calibrationMethod.description,
          version: calibrationMethod.version,
          status: calibrationMethod.status,
          assetTypeId: calibrationMethod.assetTypeId,
          assetTypeName: assetType.name,
          dataFields: calibrationMethod.dataFields,
          variableBindings: calibrationMethod.variableBindings,
          formulas: calibrationMethod.formulas,
          measurementModels: calibrationMethod.measurementModels,
          validations: calibrationMethod.validations,
          uncertaintyParams: calibrationMethod.uncertaintyParams,
          certificateContent: calibrationMethod.certificateContent,
          accreditedScope: calibrationMethod.accreditedScope,
          compiledMethod: calibrationMethod.compiledMethod,
          methodFingerprint: calibrationMethod.methodFingerprint,
          methodEngine: calibrationMethod.methodEngine,
          methodCompiledAt: calibrationMethod.methodCompiledAt,
          publicationEvidence: calibrationMethod.publicationEvidence,
          parentId: calibrationMethod.parentId,
          createdAt: calibrationMethod.createdAt,
          createdByName: user.name,
          technicalReviewedBy: calibrationMethod.technicalReviewedBy,
          technicalReviewedByName: technicalReviewerUser.name,
          publishedAt: calibrationMethod.publishedAt,
          approvedBy: calibrationMethod.approvedBy,
          approvedByName: approverUser.name,
          archivedAt: calibrationMethod.archivedAt,
        })
        .from(calibrationMethod)
        .leftJoin(assetType, eq(calibrationMethod.assetTypeId, assetType.id))
        .leftJoin(user, eq(calibrationMethod.createdBy, user.id))
        .leftJoin(
          technicalReviewerUser,
          eq(calibrationMethod.technicalReviewedBy, technicalReviewerUser.id),
        )
        .leftJoin(
          approverUser,
          eq(calibrationMethod.approvedBy, approverUser.id),
        )
        .where(
          and(
            eq(calibrationMethod.id, id),
            eq(calibrationMethod.organizationId, member.organizationId),
          ),
        )
        .limit(1);

      if (!method) {
        return c.json({ error: "Método nao encontrado" }, 404);
      }

      return c.json(normalizeMethodRecord(method));
    } catch (error) {
      console.error("Error getting method:", error);
      return c.json({ error: "Erro ao buscar método" }, 500);
    }
  })

  // =========================================================================
  // POST / - Create a new method (always DRAFT)
  // =========================================================================
  .post(
    "/",
    ...withLabPermission({ template: ["create"] }),
    zValidator("json", CreateMethodSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");

      try {
        // Check for duplicate name in same org (version 1)
        const [existing] = await db
          .select()
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.organizationId, member.organizationId),
              eq(calibrationMethod.name, input.name),
              eq(calibrationMethod.version, 1),
            ),
          )
          .limit(1);

        if (existing) {
          return c.json({ error: "Ja existe um método com este nome" }, 400);
        }

        // DOM-10 dimensional gate: reject an incoherent field/formula set before
        // it is ever persisted (no method row escapes the check when written).
        const dimensionalError = dimensionalGateError(input);
        if (dimensionalError) {
          return c.json(dimensionalError, 422);
        }

        // Create method
        const [newMethod] = await db
          .insert(calibrationMethod)
          .values({
            organizationId: member.organizationId,
            assetTypeId: input.assetTypeId || null,
            name: input.name,
            description: input.description || null,
            version: 1,
            status: "DRAFT",
            dataFields: input.dataFields,
            variableBindings: input.variableBindings,
            formulas: input.formulas,
            measurementModels: input.measurementModels,
            validations: input.validations,
            uncertaintyParams: input.uncertaintyParams,
            certificateContent: input.certificateContent ?? null,
            accreditedScope: input.accreditedScope ?? false,
            createdBy: session.user.id,
          })
          .returning();

        if (!newMethod) {
          return c.json({ error: "Erro ao criar método" }, 500);
        }

        // Audit log
        await db.insert(methodAuditLog).values({
          methodId: newMethod.id,
          action: "create",
          changes: { initial: input },
          performedBy: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
        });

        return c.json(newMethod, 201);
      } catch (error) {
        console.error("Error creating method:", error);
        return c.json({ error: "Erro ao criar método" }, 500);
      }
    },
  )

  // =========================================================================
  // POST /from-template - Create a DRAFT method from a curated template
  // (@calibra-facil/method-templates). The DRAFT then follows the normal
  // review -> publish workflow; the metrologist signs off before publish.
  // =========================================================================
  .post(
    "/from-template",
    ...withLabPermission({ template: ["create"] }),
    zValidator("json", FromTemplateSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");

      try {
        const template = listTemplates().find(
          (candidate) => candidate.key === input.templateKey,
        );
        if (!template) {
          return c.json({ error: "Template não encontrado" }, 404);
        }

        // Informed-adoption gate (ISO/IEC 17025 §7.2.1.5): every action-severity
        // [VERIFICAR] item that carries a ref must be explicitly acknowledged.
        // (The three consent booleans are already enforced by FromTemplateSchema.)
        const governance = template.governance;
        const acknowledgements = input.acknowledgements;
        const requiredActionRefs = (governance?.verificarItems ?? [])
          .filter((item) => item.severity === "action")
          .map((item) => item.ref)
          .filter((ref): ref is string => typeof ref === "string");
        const missingRefs = requiredActionRefs.filter(
          (ref) => !acknowledgements.acceptedVerificarRefs.includes(ref),
        );
        if (missingRefs.length > 0) {
          return c.json(
            {
              error:
                "Reconhecimentos pendentes para itens [VERIFICAR] de ação do modelo",
              missing: missingRefs,
            },
            400,
          );
        }

        const def = template.productDefinition;
        const name = input.name ?? def.name;

        // Resolve the asset type: explicit override wins, else the template's
        // slug -> asset_type.id, else null.
        let assetTypeId: number | null = input.assetTypeId ?? null;
        if (assetTypeId === null && def.assetTypeSlug) {
          const [matchedAssetType] = await db
            .select({ id: assetType.id })
            .from(assetType)
            .where(eq(assetType.slug, def.assetTypeSlug))
            .limit(1);
          assetTypeId = matchedAssetType?.id ?? null;
        }

        // Same uniqueness guard as POST /.
        const [existing] = await db
          .select()
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.organizationId, member.organizationId),
              eq(calibrationMethod.name, name),
              eq(calibrationMethod.version, 1),
            ),
          )
          .limit(1);

        if (existing) {
          return c.json({ error: "Ja existe um método com este nome" }, 400);
        }

        // DOM-10 dimensional gate on template instantiation: a curated template
        // must be dimensionally coherent before it becomes a DRAFT method.
        const dimensionalError = dimensionalGateError(def);
        if (dimensionalError) {
          return c.json(dimensionalError, 422);
        }

        const [newMethod] = await db
          .insert(calibrationMethod)
          .values({
            organizationId: member.organizationId,
            assetTypeId,
            name,
            description: def.description ?? null,
            version: 1,
            status: "DRAFT",
            dataFields: def.dataFields,
            variableBindings: def.variableBindings,
            formulas: def.formulas,
            measurementModels: def.measurementModels,
            validations: def.validations,
            uncertaintyParams: def.uncertaintyParams,
            certificateContent: def.certificateContent,
            accreditedScope: def.accreditedScope,
            templateKey: template.key,
            templateVersion: template.templateVersion,
            createdBy: session.user.id,
          })
          .returning();

        if (!newMethod) {
          return c.json({ error: "Erro ao criar método" }, 500);
        }

        await db.insert(methodAuditLog).values({
          methodId: newMethod.id,
          action: "create",
          // Freeze the adoption evidence (ISO/IEC 17025 §7.2.1.5): the
          // acknowledgements + an immutable snapshot of the cited sources (with
          // editions) and the verbatim [VERIFICAR]/omitted items at adoption
          // time — demonstrable to an auditor and immune to later template edits.
          changes: {
            fromTemplate: template.key,
            templateVersion: template.templateVersion,
            acknowledgements,
            governanceSnapshot: governance
              ? {
                  sources: governance.sources,
                  verificarItems: governance.verificarItems,
                  omittedComponents: governance.omittedComponents,
                }
              : null,
          },
          performedBy: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
        });

        return c.json(newMethod, 201);
      } catch (error) {
        console.error("Error creating method from template:", error);
        return c.json({ error: "Erro ao criar método a partir do modelo" }, 500);
      }
    },
  )

  // =========================================================================
  // PUT /:id - Update a DRAFT method
  // =========================================================================
  .put(
    "/:id",
    ...withLabPermission({ template: ["update"] }),
    zValidator("json", UpdateMethodSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = await resolveMethodRouteId(
        c.req.param("id"),
        member.organizationId,
      );
      const input = c.req.valid("json");

      if (id === null) {
        return c.json({ error: "Método nao encontrado" }, 404);
      }

      try {
        // Get existing method
        const [existing] = await db
          .select()
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.id, id),
              eq(calibrationMethod.organizationId, member.organizationId),
            ),
          )
          .limit(1);

        if (!existing) {
          return c.json({ error: "Método nao encontrado" }, 404);
        }

        // Only DRAFT can be updated
        if (existing.status !== "DRAFT") {
          return c.json(
            { error: "Apenas métodos em rascunho podem ser editados" },
            400,
          );
        }

        // Check for name conflict if name is being changed
        // Check against all versions to prevent naming conflicts
        if (input.name && input.name !== existing.name) {
          const [duplicate] = await db
            .select()
            .from(calibrationMethod)
            .where(
              and(
                eq(calibrationMethod.organizationId, member.organizationId),
                eq(calibrationMethod.name, input.name),
                ne(calibrationMethod.id, id),
              ),
            )
            .limit(1);

          if (duplicate) {
            return c.json({ error: "Ja existe um método com este nome" }, 400);
          }
        }

        // Build update object
        const updateData: Record<string, unknown> = {};
        const changes: Record<string, { old: unknown; new: unknown }> = {};

        if (input.name !== undefined && input.name !== existing.name) {
          updateData.name = input.name;
          changes.name = { old: existing.name, new: input.name };
        }
        if (input.description !== undefined) {
          updateData.description = input.description || null;
          changes.description = {
            old: existing.description,
            new: input.description,
          };
        }
        if (input.assetTypeId !== undefined) {
          updateData.assetTypeId = input.assetTypeId || null;
          changes.assetTypeId = {
            old: existing.assetTypeId,
            new: input.assetTypeId,
          };
        }
        if (input.dataFields !== undefined) {
          updateData.dataFields = input.dataFields;
          changes.dataFields = {
            old: existing.dataFields,
            new: input.dataFields,
          };
        }
        if (input.variableBindings !== undefined) {
          updateData.variableBindings = input.variableBindings;
          changes.variableBindings = {
            old: existing.variableBindings,
            new: input.variableBindings,
          };
        }
        if (input.formulas !== undefined) {
          updateData.formulas = input.formulas;
          changes.formulas = { old: existing.formulas, new: input.formulas };
        }
        if (input.measurementModels !== undefined) {
          updateData.measurementModels = input.measurementModels;
          changes.measurementModels = {
            old: existing.measurementModels,
            new: input.measurementModels,
          };
        }
        if (input.validations !== undefined) {
          updateData.validations = input.validations;
          changes.validations = {
            old: existing.validations,
            new: input.validations,
          };
        }
        if (input.uncertaintyParams !== undefined) {
          updateData.uncertaintyParams = input.uncertaintyParams;
          changes.uncertaintyParams = {
            old: existing.uncertaintyParams,
            new: input.uncertaintyParams,
          };
        }
        if (input.certificateContent !== undefined) {
          updateData.certificateContent = input.certificateContent;
          changes.certificateContent = {
            old: existing.certificateContent,
            new: input.certificateContent,
          };
        }
        if (
          input.accreditedScope !== undefined &&
          input.accreditedScope !== existing.accreditedScope
        ) {
          updateData.accreditedScope = input.accreditedScope;
          changes.accreditedScope = {
            old: existing.accreditedScope,
            new: input.accreditedScope,
          };
        }

        if (Object.keys(updateData).length === 0) {
          return c.json(existing);
        }

        // DOM-10 dimensional gate on the EFFECTIVE post-update field/formula set
        // (incoming edits overlaid on the stored draft). Reject before persisting
        // so the row stays unchanged on a dimensional incoherence.
        const dimensionalError = dimensionalGateError({
          dataFields: input.dataFields ?? existing.dataFields,
          variableBindings: input.variableBindings ?? existing.variableBindings,
          formulas: input.formulas ?? existing.formulas,
          measurementModels:
            input.measurementModels ?? existing.measurementModels,
        });
        if (dimensionalError) {
          return c.json(dimensionalError, 422);
        }

        updateData.compiledMethod = null;
        updateData.methodFingerprint = null;
        updateData.methodEngine = null;
        updateData.methodCompiledAt = null;
        updateData.publicationEvidence = null;

        // Update method
        const [updated] = await db
          .update(calibrationMethod)
          .set(updateData)
          .where(eq(calibrationMethod.id, id))
          .returning();

        // Audit log
        await db.insert(methodAuditLog).values({
          methodId: id,
          action: "update",
          changes,
          performedBy: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
        });

        return c.json(updated);
      } catch (error) {
        console.error("Error updating method:", error);
        return c.json({ error: "Erro ao atualizar método" }, 500);
      }
    },
  )

  // =========================================================================
  // POST /:id/request-approval - Submit method for approval
  // =========================================================================
  .post(
    "/:id/request-approval",
    ...withLabPermission({ template: ["update"] }),
    requireFeature("approval_workflow"),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = await resolveMethodRouteId(
        c.req.param("id"),
        member.organizationId,
      );

      if (id === null) {
        return c.json({ error: "Método nao encontrado" }, 404);
      }

      try {
        const [existing] = await db
          .select()
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.id, id),
              eq(calibrationMethod.organizationId, member.organizationId),
            ),
          )
          .limit(1);

        if (!existing) {
          return c.json({ error: "Método nao encontrado" }, 404);
        }

        if (existing.status !== "DRAFT") {
          return c.json(
            { error: "Apenas rascunhos podem ser enviados para aprovacao" },
            400,
          );
        }

        // Validate method has required fields
        if (!existing.dataFields || existing.dataFields.length === 0) {
          return c.json(
            { error: "Método deve ter pelo menos um campo de entrada" },
            400,
          );
        }

        const body = recordFromUnknown(await c.req.json().catch(() => ({})));
        const previewScenarios = buildAdhocPreviewScenarios(
          objectRecord(body.sampleData) ?? undefined,
        );
        const compileResult = compileDraftWithEngine(
          methodRecordToDraft(existing),
          {
            requirePublishable: true,
            previewScenarios,
            includePreviewScenariosInFingerprint: false,
          },
        );
        if (!compileResult.ok) {
          return c.json(
            {
              error: diagnosticsMessage(compileResult.diagnostics),
              diagnostics: compileResult.diagnostics,
            },
            422,
          );
        }
        const uncertaintyDiagnostics = unmodeledUncertaintyDiagnostics({
          uncertaintyParams: existing.uncertaintyParams,
          compiledMethod: compileResult.method,
        });
        if (uncertaintyDiagnostics.length > 0) {
          return c.json(
            {
              error: diagnosticsMessage(uncertaintyDiagnostics),
              diagnostics: uncertaintyDiagnostics,
            },
            422,
          );
        }
        // DOM-10 dimensional gate on the publish-transition recompile (the engine
        // is dimension-blind by design, so this is the check that catches an
        // incoherent unit set on submit-for-approval).
        const dimensionalError = dimensionalGateError(existing);
        if (dimensionalError) {
          return c.json(dimensionalError, 422);
        }

        const [updated] = await db
          .update(calibrationMethod)
          .set({
            status: "PENDING_APPROVAL",
            technicalReviewedBy: null,
            approvedBy: null,
            publishedAt: null,
            publishedBy: null,
            compiledMethod: compileResult.method,
            methodFingerprint: compileResult.method.methodFingerprint,
            methodEngine: compileResult.method.engine,
            methodCompiledAt: new Date(),
            publicationEvidence: buildReviewPreviewEvidence({
              compiledMethod: compileResult.method,
              previewScenarios,
              previewResults: compileResult.previewResults,
              diagnostics: compileResult.diagnostics,
              compiledBy: session.user.id,
            }),
          })
          .where(eq(calibrationMethod.id, id))
          .returning();

        await db.insert(methodAuditLog).values({
          methodId: id,
          action: "request_approval",
          changes: {
            status: { old: "DRAFT", new: "PENDING_APPROVAL" },
            methodFingerprint: {
              old: existing.methodFingerprint,
              new: compileResult.method.methodFingerprint,
            },
          },
          performedBy: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
        });

        return c.json(updated);
      } catch (error) {
        console.error("Error requesting method approval:", error);
        return c.json({ error: "Erro ao solicitar aprovacao" }, 500);
      }
    },
  )

  // =========================================================================
  // POST /:id/technical-review - Technical review (admin only)
  // =========================================================================
  .post(
    "/:id/technical-review",
    ...withLabPermission({ template: ["publish"] }),
    requireFeature("approval_workflow"),
    requireRole(["admin"]),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = await resolveMethodRouteId(
        c.req.param("id"),
        member.organizationId,
      );

      if (id === null) {
        return c.json({ error: "Método nao encontrado" }, 404);
      }

      try {
        const [existing] = await db
          .select()
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.id, id),
              eq(calibrationMethod.organizationId, member.organizationId),
            ),
          )
          .limit(1);

        if (!existing) {
          return c.json({ error: "Método nao encontrado" }, 404);
        }

        if (existing.status !== "PENDING_APPROVAL") {
          return c.json(
            { error: "Apenas métodos pendentes podem ser revisados" },
            400,
          );
        }

        const [updated] = await db
          .update(calibrationMethod)
          .set({
            status: "TECHNICAL_REVIEWED",
            technicalReviewedBy: session.user.id,
          })
          .where(eq(calibrationMethod.id, id))
          .returning();

        await db.insert(methodAuditLog).values({
          methodId: id,
          action: "technical_review",
          changes: {
            status: { old: "PENDING_APPROVAL", new: "TECHNICAL_REVIEWED" },
            technicalReviewedBy: { old: null, new: session.user.id },
          },
          performedBy: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
        });

        return c.json(updated);
      } catch (error) {
        console.error("Error technical reviewing method:", error);
        return c.json({ error: "Erro ao revisar tecnicamente" }, 500);
      }
    },
  )

  // =========================================================================
  // POST /:id/quality-approve - Quality approval (owner only)
  // =========================================================================
  .post(
    "/:id/quality-approve",
    ...withLabPermission({ template: ["publish"] }),
    requireFeature("approval_workflow"),
    requireRole(["owner"]),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = await resolveMethodRouteId(
        c.req.param("id"),
        member.organizationId,
      );

      if (id === null) {
        return c.json({ error: "Método nao encontrado" }, 404);
      }

      try {
        const [existing] = await db
          .select()
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.id, id),
              eq(calibrationMethod.organizationId, member.organizationId),
            ),
          )
          .limit(1);

        if (!existing) {
          return c.json({ error: "Método nao encontrado" }, 404);
        }

        if (existing.status !== "TECHNICAL_REVIEWED") {
          return c.json(
            { error: "Apenas métodos revisados podem ser aprovados" },
            400,
          );
        }

        if (!existing.technicalReviewedBy) {
          return c.json(
            { error: "Revisao tecnica obrigatoria antes da aprovacao" },
            400,
          );
        }

        if (existing.technicalReviewedBy === session.user.id) {
          return c.json(
            {
              error:
                "Revisao tecnica e aprovacao de qualidade devem ser feitas por usuarios diferentes",
            },
            400,
          );
        }

        // Validate method has required fields
        if (!existing.dataFields || existing.dataFields.length === 0) {
          return c.json(
            { error: "Método deve ter pelo menos um campo de entrada" },
            400,
          );
        }

        const body = recordFromUnknown(await c.req.json().catch(() => ({})));
        const publishDraft = methodRecordToDraft({
          ...existing,
          status: "PUBLISHED",
        });
        const previewScenarios = resolvePublicationPreviewScenarios(
          objectRecord(body.sampleData) ?? undefined,
          existing.publicationEvidence,
          existing.methodFingerprint,
        );
        const compileResult = compileDraftWithEngine(publishDraft, {
          requirePublishable: true,
          previewScenarios,
          includePreviewScenariosInFingerprint: false,
        });
        if (!compileResult.ok) {
          return c.json(
            {
              error: diagnosticsMessage(compileResult.diagnostics),
              diagnostics: compileResult.diagnostics,
            },
            422,
          );
        }
        const uncertaintyDiagnostics = unmodeledUncertaintyDiagnostics({
          uncertaintyParams: existing.uncertaintyParams,
          compiledMethod: compileResult.method,
        });
        if (uncertaintyDiagnostics.length > 0) {
          return c.json(
            {
              error: diagnosticsMessage(uncertaintyDiagnostics),
              diagnostics: uncertaintyDiagnostics,
            },
            422,
          );
        }
        // DOM-10 dimensional gate on the publish recompile — no method row
        // reaches PUBLISHED with a dimensional incoherence.
        const dimensionalError = dimensionalGateError(existing);
        if (dimensionalError) {
          return c.json(dimensionalError, 422);
        }
        const publicationEvidence = buildPublicationEvidence({
          methodId: existing.id,
          version: existing.version,
          compiledMethod: compileResult.method,
          previewScenarios,
          previewResults: compileResult.previewResults,
          diagnostics: compileResult.diagnostics,
          reviewedBy: existing.technicalReviewedBy,
          publishedBy: session.user.id,
          reasonForChange:
            typeof body.reasonForChange === "string"
              ? body.reasonForChange
              : null,
          certificateContent: existing.certificateContent,
          uncertaintyParams: existing.uncertaintyParams,
          measurementModels: existing.measurementModels,
        });

        // Archive any previously published version with same name
        await db
          .update(calibrationMethod)
          .set({
            status: "ARCHIVED",
            archivedAt: new Date(),
          })
          .where(
            and(
              eq(calibrationMethod.organizationId, member.organizationId),
              eq(calibrationMethod.name, existing.name),
              eq(calibrationMethod.status, "PUBLISHED"),
              ne(calibrationMethod.id, id),
            ),
          );

        const [published] = await db
          .update(calibrationMethod)
          .set({
            status: "PUBLISHED",
            publishedAt: new Date(),
            publishedBy: session.user.id,
            approvedBy: session.user.id,
            compiledMethod: compileResult.method,
            methodFingerprint: compileResult.method.methodFingerprint,
            methodEngine: compileResult.method.engine,
            methodCompiledAt: new Date(),
            publicationEvidence,
          })
          .where(eq(calibrationMethod.id, id))
          .returning();

        await db.insert(methodAuditLog).values({
          methodId: id,
          action: "quality_approve",
          changes: {
            status: { old: "TECHNICAL_REVIEWED", new: "PUBLISHED" },
            methodFingerprint: {
              old: existing.methodFingerprint,
              new: compileResult.method.methodFingerprint,
            },
          },
          performedBy: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
        });

        return c.json(published);
      } catch (error) {
        console.error("Error quality approving method:", error);
        return c.json({ error: "Erro ao aprovar qualidade" }, 500);
      }
    },
  )

  // =========================================================================
  // POST /:id/return-to-draft - Return method to draft (admin/owner)
  // =========================================================================
  .post(
    "/:id/return-to-draft",
    ...withLabPermission({ template: ["update"] }),
    requireFeature("approval_workflow"),
    requireRole(["admin", "owner"]),
    zValidator("json", ReturnMethodToDraftSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = await resolveMethodRouteId(
        c.req.param("id"),
        member.organizationId,
      );
      const { reason } = c.req.valid("json");

      if (id === null) {
        return c.json({ error: "Método nao encontrado" }, 404);
      }

      try {
        const [existing] = await db
          .select()
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.id, id),
              eq(calibrationMethod.organizationId, member.organizationId),
            ),
          )
          .limit(1);

        if (!existing) {
          return c.json({ error: "Método nao encontrado" }, 404);
        }

        if (
          existing.status !== "PENDING_APPROVAL" &&
          existing.status !== "TECHNICAL_REVIEWED"
        ) {
          return c.json(
            { error: "Apenas métodos em aprovacao podem retornar ao rascunho" },
            400,
          );
        }

        const [updated] = await db
          .update(calibrationMethod)
          .set({
            status: "DRAFT",
            technicalReviewedBy: null,
            approvedBy: null,
            publishedAt: null,
            publishedBy: null,
            compiledMethod: null,
            methodFingerprint: null,
            methodEngine: null,
            methodCompiledAt: null,
            publicationEvidence: null,
          })
          .where(eq(calibrationMethod.id, id))
          .returning();

        await db.insert(methodAuditLog).values({
          methodId: id,
          action: "return_to_draft",
          changes: { status: { old: existing.status, new: "DRAFT" } },
          performedBy: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
          reason,
        });

        return c.json(updated);
      } catch (error) {
        console.error("Error returning method to draft:", error);
        return c.json({ error: "Erro ao retornar para rascunho" }, 500);
      }
    },
  )

  // =========================================================================
  // POST /:id/publish - Publish a TECHNICAL_REVIEWED method (compat)
  // =========================================================================
  .post(
    "/:id/publish",
    ...withLabPermission({ template: ["publish"] }),
    requireFeature("approval_workflow"),
    requireRole(["owner"]),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = await resolveMethodRouteId(
        c.req.param("id"),
        member.organizationId,
      );

      if (id === null) {
        return c.json({ error: "Método nao encontrado" }, 404);
      }

      try {
        const [existing] = await db
          .select()
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.id, id),
              eq(calibrationMethod.organizationId, member.organizationId),
            ),
          )
          .limit(1);

        if (!existing) {
          return c.json({ error: "Método nao encontrado" }, 404);
        }

        if (existing.status !== "TECHNICAL_REVIEWED") {
          return c.json(
            { error: "Apenas métodos revisados podem ser publicados" },
            400,
          );
        }

        if (!existing.technicalReviewedBy) {
          return c.json(
            { error: "Revisao tecnica obrigatoria antes da publicacao" },
            400,
          );
        }

        if (existing.technicalReviewedBy === session.user.id) {
          return c.json(
            {
              error:
                "Revisao tecnica e publicacao devem ser feitas por usuarios diferentes",
            },
            400,
          );
        }

        // Validate method has required fields
        if (!existing.dataFields || existing.dataFields.length === 0) {
          return c.json(
            { error: "Método deve ter pelo menos um campo de entrada" },
            400,
          );
        }

        const body = recordFromUnknown(await c.req.json().catch(() => ({})));
        const publishDraft = methodRecordToDraft({
          ...existing,
          status: "PUBLISHED",
        });
        const previewScenarios = resolvePublicationPreviewScenarios(
          objectRecord(body.sampleData) ?? undefined,
          existing.publicationEvidence,
          existing.methodFingerprint,
        );
        const compileResult = compileDraftWithEngine(publishDraft, {
          requirePublishable: true,
          previewScenarios,
          includePreviewScenariosInFingerprint: false,
        });
        if (!compileResult.ok) {
          return c.json(
            {
              error: diagnosticsMessage(compileResult.diagnostics),
              diagnostics: compileResult.diagnostics,
            },
            422,
          );
        }
        const uncertaintyDiagnostics = unmodeledUncertaintyDiagnostics({
          uncertaintyParams: existing.uncertaintyParams,
          compiledMethod: compileResult.method,
        });
        if (uncertaintyDiagnostics.length > 0) {
          return c.json(
            {
              error: diagnosticsMessage(uncertaintyDiagnostics),
              diagnostics: uncertaintyDiagnostics,
            },
            422,
          );
        }
        // DOM-10 dimensional gate on the publish recompile — no method row
        // reaches PUBLISHED with a dimensional incoherence.
        const dimensionalError = dimensionalGateError(existing);
        if (dimensionalError) {
          return c.json(dimensionalError, 422);
        }
        const publicationEvidence = buildPublicationEvidence({
          methodId: existing.id,
          version: existing.version,
          compiledMethod: compileResult.method,
          previewScenarios,
          previewResults: compileResult.previewResults,
          diagnostics: compileResult.diagnostics,
          reviewedBy: existing.technicalReviewedBy,
          publishedBy: session.user.id,
          reasonForChange:
            typeof body.reasonForChange === "string"
              ? body.reasonForChange
              : null,
          certificateContent: existing.certificateContent,
          uncertaintyParams: existing.uncertaintyParams,
          measurementModels: existing.measurementModels,
        });

        // Archive any previously published version with same name
        await db
          .update(calibrationMethod)
          .set({
            status: "ARCHIVED",
            archivedAt: new Date(),
          })
          .where(
            and(
              eq(calibrationMethod.organizationId, member.organizationId),
              eq(calibrationMethod.name, existing.name),
              eq(calibrationMethod.status, "PUBLISHED"),
              ne(calibrationMethod.id, id),
            ),
          );

        // Publish
        const [published] = await db
          .update(calibrationMethod)
          .set({
            status: "PUBLISHED",
            publishedAt: new Date(),
            publishedBy: session.user.id,
            approvedBy: session.user.id,
            compiledMethod: compileResult.method,
            methodFingerprint: compileResult.method.methodFingerprint,
            methodEngine: compileResult.method.engine,
            methodCompiledAt: new Date(),
            publicationEvidence,
          })
          .where(eq(calibrationMethod.id, id))
          .returning();

        // Audit log
        await db.insert(methodAuditLog).values({
          methodId: id,
          action: "publish",
          changes: {
            status: { old: existing.status, new: "PUBLISHED" },
            methodFingerprint: {
              old: existing.methodFingerprint,
              new: compileResult.method.methodFingerprint,
            },
          },
          performedBy: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
        });

        return c.json(published);
      } catch (error) {
        console.error("Error publishing method:", error);
        return c.json({ error: "Erro ao publicar método" }, 500);
      }
    },
  )

  // =========================================================================
  // POST /:id/archive - Archive a PUBLISHED method
  // =========================================================================
  .post(
    "/:id/archive",
    ...withLabPermission({ template: ["update"] }),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = await resolveMethodRouteId(
        c.req.param("id"),
        member.organizationId,
      );

      if (id === null) {
        return c.json({ error: "Método nao encontrado" }, 404);
      }

      try {
        const [existing] = await db
          .select()
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.id, id),
              eq(calibrationMethod.organizationId, member.organizationId),
            ),
          )
          .limit(1);

        if (!existing) {
          return c.json({ error: "Método nao encontrado" }, 404);
        }

        if (existing.status !== "PUBLISHED") {
          return c.json(
            { error: "Apenas métodos publicados podem ser arquivados" },
            400,
          );
        }

        const [archived] = await db
          .update(calibrationMethod)
          .set({
            status: "ARCHIVED",
            archivedAt: new Date(),
          })
          .where(eq(calibrationMethod.id, id))
          .returning();

        // Audit log
        await db.insert(methodAuditLog).values({
          methodId: id,
          action: "archive",
          changes: { status: { old: "PUBLISHED", new: "ARCHIVED" } },
          performedBy: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
        });

        return c.json(archived);
      } catch (error) {
        console.error("Error archiving method:", error);
        return c.json({ error: "Erro ao arquivar método" }, 500);
      }
    },
  )

  // =========================================================================
  // POST /:id/new-version - Create new DRAFT from PUBLISHED (versioning)
  // =========================================================================
  .post(
    "/:id/new-version",
    ...withLabPermission({ template: ["create"] }),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = await resolveMethodRouteId(
        c.req.param("id"),
        member.organizationId,
      );

      if (id === null) {
        return c.json({ error: "Método nao encontrado" }, 404);
      }

      try {
        const [existing] = await db
          .select()
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.id, id),
              eq(calibrationMethod.organizationId, member.organizationId),
            ),
          )
          .limit(1);

        if (!existing) {
          return c.json({ error: "Método nao encontrado" }, 404);
        }

        if (existing.status !== "PUBLISHED") {
          return c.json(
            {
              error:
                "Novas versoes so podem ser criadas a partir de métodos publicados",
            },
            400,
          );
        }

        // Check if there's already a draft for this method
        const [existingDraft] = await db
          .select()
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.organizationId, member.organizationId),
              eq(calibrationMethod.name, existing.name),
              eq(calibrationMethod.status, "DRAFT"),
            ),
          )
          .limit(1);

        if (existingDraft) {
          return c.json(
            {
              error:
                "Ja existe um rascunho para este método. Edite o rascunho existente ou exclua-o antes de criar uma nova versão.",
              existingDraftId: existingDraft.id,
            },
            400,
          );
        }

        // Find the highest version number
        const [maxVersion] = await db
          .select({ maxVersion: calibrationMethod.version })
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.organizationId, member.organizationId),
              eq(calibrationMethod.name, existing.name),
            ),
          )
          .orderBy(desc(calibrationMethod.version))
          .limit(1);

        const newVersion = (maxVersion?.maxVersion || existing.version) + 1;

        // Clone the method
        const [newMethod] = await db
          .insert(calibrationMethod)
          .values({
            organizationId: member.organizationId,
            assetTypeId: existing.assetTypeId,
            name: existing.name,
            description: existing.description,
            version: newVersion,
            status: "DRAFT",
            dataFields: existing.dataFields,
            variableBindings: existing.variableBindings ?? [],
            formulas: existing.formulas,
            measurementModels: existing.measurementModels ?? [],
            validations: normalizeMethodValidationsInput(existing.validations),
            uncertaintyParams: existing.uncertaintyParams,
            certificateContent: existing.certificateContent,
            accreditedScope: existing.accreditedScope,
            parentId: existing.id,
            createdBy: session.user.id,
          })
          .returning();

        if (!newMethod) {
          return c.json({ error: "Erro ao criar nova versão" }, 500);
        }

        // Audit log
        await db.insert(methodAuditLog).values({
          methodId: newMethod.id,
          action: "new_version",
          changes: {
            parentId: existing.id,
            parentVersion: existing.version,
            newVersion,
          },
          performedBy: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
        });

        return c.json(normalizeMethodRecord(newMethod), 201);
      } catch (error) {
        console.error("Error creating new version:", error);
        return c.json({ error: "Erro ao criar nova versão" }, 500);
      }
    },
  )

  // =========================================================================
  // DELETE /:id - Delete a DRAFT method only
  // =========================================================================
  .delete("/:id", ...withLabPermission({ template: ["delete"] }), async (c) => {
    const session = c.get("session");
    const member = c.get("member");
    const id = await resolveMethodRouteId(
      c.req.param("id"),
      member.organizationId,
    );

    if (id === null) {
      return c.json({ error: "Método nao encontrado" }, 404);
    }

    try {
      const [existing] = await db
        .select()
        .from(calibrationMethod)
        .where(
          and(
            eq(calibrationMethod.id, id),
            eq(calibrationMethod.organizationId, member.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Método nao encontrado" }, 404);
      }

      if (existing.status !== "DRAFT") {
        return c.json(
          {
            error:
              "Apenas rascunhos podem ser excluidos. métodos publicados devem ser arquivados.",
          },
          400,
        );
      }

      // CMP-06 (#649): record the deletion in the audit trail BEFORE deleting —
      // mirrors customers.ts. The method_id FK no longer cascades (soft
      // reference), so this row outlives the method it documents.
      await db.insert(methodAuditLog).values({
        methodId: id,
        action: "delete",
        changes: { method: { old: existing, new: null } },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      await db.delete(calibrationMethod).where(eq(calibrationMethod.id, id));

      return c.json({ success: true });
    } catch (error) {
      console.error("Error deleting method:", error);
      return c.json({ error: "Erro ao excluir método" }, 500);
    }
  })

  // =========================================================================
  // GET /:id/versions - Get version history for a method
  // =========================================================================
  .get(
    "/:id/versions",
    ...withLabPermission({ template: ["read"] }),
    async (c) => {
      const member = c.get("member");
      const id = await resolveMethodRouteId(
        c.req.param("id"),
        member.organizationId,
      );

      if (id === null) {
        return c.json({ error: "Método nao encontrado" }, 404);
      }

      try {
        // Get the method to find its name
        const [method] = await db
          .select({ name: calibrationMethod.name })
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.id, id),
              eq(calibrationMethod.organizationId, member.organizationId),
            ),
          )
          .limit(1);

        if (!method) {
          return c.json({ error: "Método nao encontrado" }, 404);
        }

        // Get all versions with this name
        const versions = await db
          .select({
            id: calibrationMethod.id,
            version: calibrationMethod.version,
            status: calibrationMethod.status,
            createdAt: calibrationMethod.createdAt,
            publishedAt: calibrationMethod.publishedAt,
            archivedAt: calibrationMethod.archivedAt,
          })
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.organizationId, member.organizationId),
              eq(calibrationMethod.name, method.name),
            ),
          )
          .orderBy(desc(calibrationMethod.version));

        return c.json({ data: versions });
      } catch (error) {
        console.error("Error getting versions:", error);
        return c.json({ error: "Erro ao buscar versoes" }, 500);
      }
    },
  )

  // =========================================================================
  // GET /:id/audit - Get audit log for a method
  // =========================================================================
  .get(
    "/:id/audit",
    ...withLabPermission({ template: ["read"] }),
    requireFeature("advanced_audit_trail"),
    async (c) => {
      const member = c.get("member");
      const id = await resolveMethodRouteId(
        c.req.param("id"),
        member.organizationId,
      );

      if (id === null) {
        return c.json({ error: "Método nao encontrado" }, 404);
      }

      try {
        // Verify method belongs to org
        const [method] = await db
          .select({ id: calibrationMethod.id })
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.id, id),
              eq(calibrationMethod.organizationId, member.organizationId),
            ),
          )
          .limit(1);

        if (!method) {
          return c.json({ error: "Método nao encontrado" }, 404);
        }

        const logs = await db
          .select({
            id: methodAuditLog.id,
            action: methodAuditLog.action,
            changes: methodAuditLog.changes,
            performedAt: methodAuditLog.performedAt,
            performedByName: user.name,
            reason: methodAuditLog.reason,
          })
          .from(methodAuditLog)
          .leftJoin(user, eq(methodAuditLog.performedBy, user.id))
          .where(eq(methodAuditLog.methodId, id))
          .orderBy(desc(methodAuditLog.performedAt));

        return c.json({ data: logs });
      } catch (error) {
        console.error("Error getting audit log:", error);
        return c.json({ error: "Erro ao buscar historico" }, 500);
      }
    },
  );
