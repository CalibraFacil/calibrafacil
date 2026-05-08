import { parseMethodDraft } from "./normalize";
import type {
  MethodDiagnostic,
  MethodDraft,
  MethodInput,
  MethodAcceptanceCriterion,
  MethodFormula,
} from "./types";

type LegacyMethod = {
  id?: string | number;
  version?: number;
  name?: string;
  description?: string | null;
  assetTypeId?: string | number | null;
  dataFields?: unknown[];
  formulas?: unknown[];
  validations?: unknown[];
};

export type MethodDraftMigrationResult = {
  draft: MethodDraft;
  diagnostics: MethodDiagnostic[];
  requiresManualReview: true;
};

export function migrateLegacyMethodToDraft(
  legacy: unknown,
): MethodDraftMigrationResult {
  const record = (legacy ?? {}) as LegacyMethod;
  const diagnostics: MethodDiagnostic[] = [
    {
      code: "LEGACY_METHOD_REQUIRES_REVALIDATION",
      severity: "warning",
      message: "Legacy method was migrated as draft and requires manual revalidation",
      path: "draft.metadata.validationStatus",
    },
  ];

  const rawDraft: Record<string, unknown> = {
    id: safeId(record.id),
    version: typeof record.version === "number" ? record.version : 1,
    status: "draft",
    name: typeof record.name === "string" ? record.name : "Método migrado",
    inputs: migrateInputs(record.dataFields, diagnostics),
    formulas: migrateFormulas(record.formulas, diagnostics),
    measurementModels: [],
    acceptanceCriteria: migrateValidations(record.validations, diagnostics),
    previewScenarios: [],
    metadata: {
      validationStatus: "pending_revalidation",
      migratedFromLegacy: true,
    },
  };

  if (typeof record.description === "string") {
    rawDraft.description = record.description;
  }
  if (record.assetTypeId !== null && record.assetTypeId !== undefined) {
    rawDraft.assetTypeId = String(record.assetTypeId);
  }

  const draft = parseMethodDraft(stripUndefined(rawDraft));

  return { draft, diagnostics, requiresManualReview: true };
}

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) output[key] = stripUndefined(item);
    }
    return output;
  }
  return value;
}

function safeId(value: unknown): string {
  const text = value === undefined || value === null ? "migrated_method" : String(value);
  const sanitized = text.replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[a-zA-Z]/.test(sanitized) ? sanitized : `method_${sanitized}`;
}

function migrateInputs(
  fields: unknown,
  diagnostics: MethodDiagnostic[],
): MethodInput[] {
  if (!Array.isArray(fields)) return [];
  const inputs: MethodInput[] = [];

  for (const field of fields) {
    const record = field as Record<string, unknown>;
    if (typeof record.key !== "string" || typeof record.label !== "string") {
      diagnostics.push({
        code: "LEGACY_INPUT_SKIPPED",
        severity: "warning",
        message: "Legacy input could not be migrated",
        path: "dataFields",
      });
      continue;
    }

    if (record.type === "number") {
      inputs.push({
        kind: "scalar",
        key: record.key,
        label: record.label,
        unit: typeof record.unit === "string" ? record.unit : undefined,
        required: Boolean(record.required),
        quantityKind: "other",
      });
      continue;
    }

    if (record.type === "select" && Array.isArray(record.options)) {
      inputs.push({
        kind: "select",
        key: record.key,
        label: record.label,
        options: record.options.filter((item): item is string => typeof item === "string"),
        required: Boolean(record.required),
      });
      continue;
    }

    inputs.push({
      kind: "text",
      key: record.key,
      label: record.label,
      required: Boolean(record.required),
    });
  }

  return inputs;
}

function migrateFormulas(
  formulas: unknown,
  diagnostics: MethodDiagnostic[],
): MethodFormula[] {
  if (!Array.isArray(formulas)) return [];
  return formulas.flatMap((formula): MethodFormula[] => {
    const record = formula as Record<string, unknown>;
    if (
      typeof record.outputKey !== "string" ||
      typeof record.expression !== "string"
    ) {
      diagnostics.push({
        code: "LEGACY_FORMULA_SKIPPED",
        severity: "warning",
        message: "Legacy formula could not be migrated",
        path: "formulas",
      });
      return [];
    }
    return [
      {
        key: record.outputKey,
        label:
          typeof record.label === "string" ? record.label : record.outputKey,
        expression: record.expression,
        outputUnit: typeof record.unit === "string" ? record.unit : undefined,
        outputKind: "derived_quantity",
        required: true,
      },
    ];
  });
}

function migrateValidations(
  validations: unknown,
  diagnostics: MethodDiagnostic[],
): MethodAcceptanceCriterion[] {
  if (!Array.isArray(validations)) return [];
  return validations.flatMap((validation, index): MethodAcceptanceCriterion[] => {
    const record = validation as Record<string, unknown>;
    const expression =
      typeof record.expression === "string"
        ? record.expression
        : typeof record.leftExpression === "string" &&
            typeof record.operator === "string" &&
            typeof record.rightExpression === "string"
          ? `${record.leftExpression} ${record.operator} ${record.rightExpression}`
          : null;
    if (!expression || typeof record.message !== "string") {
      diagnostics.push({
        code: "LEGACY_VALIDATION_SKIPPED",
        severity: "warning",
        message: "Legacy validation could not be migrated",
        path: "validations",
      });
      return [];
    }
    return [
      {
        key: `criterion_${index + 1}`,
        label: `Critério ${index + 1}`,
        expression,
        severity: record.severity === "warning" ? "warning" : "blocking",
        message: record.message,
      },
    ];
  });
}
