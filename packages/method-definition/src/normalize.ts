import { MethodDraftSchema } from "./schemas";
import { assertSafeUnknown, normalizeSafeMetadata } from "./safety";
import type {
  MethodAcceptanceCriterion,
  MethodDraft,
  MethodFormula,
  MethodInput,
  MethodMeasurementModel,
  MethodPreviewScenario,
  MethodQuantity,
} from "./types";

export function parseMethodDraft(value: unknown): MethodDraft {
  assertSafeUnknown(value);
  return normalizeMethodDraft(MethodDraftSchema.parse(value));
}

export function normalizeMethodDraft(draft: MethodDraft): MethodDraft {
  return {
    id: draft.id.trim(),
    version: draft.version,
    status: draft.status,
    name: draft.name.trim(),
    ...(draft.description ? { description: draft.description.trim() } : {}),
    ...(draft.assetTypeId ? { assetTypeId: draft.assetTypeId.trim() } : {}),
    ...(draft.discipline ? { discipline: draft.discipline.trim() } : {}),
    inputs: draft.inputs.map(normalizeMethodInput),
    formulas: draft.formulas.map(normalizeFormula),
    measurementModels: draft.measurementModels.map(normalizeMeasurementModel),
    acceptanceCriteria: draft.acceptanceCriteria.map(normalizeAcceptanceCriterion),
    previewScenarios: draft.previewScenarios.map(normalizePreviewScenario),
    metadata: normalizeSafeMetadata(draft.metadata) ?? {},
  };
}

function normalizeMethodInput(input: MethodInput): MethodInput {
  switch (input.kind) {
    case "scalar":
      return {
        ...input,
        key: input.key.trim(),
        label: input.label.trim(),
        ...(input.unit ? { unit: input.unit.trim() } : {}),
        ...(input.metadata
          ? { metadata: normalizeSafeMetadata(input.metadata) }
          : {}),
      };
    case "repeated_observation":
      return {
        ...input,
        key: input.key.trim(),
        label: input.label.trim(),
        ...(input.unit ? { unit: input.unit.trim() } : {}),
        ...(input.metadata
          ? { metadata: normalizeSafeMetadata(input.metadata) }
          : {}),
      };
    case "table":
      return {
        ...input,
        key: input.key.trim(),
        label: input.label.trim(),
        columns: input.columns.map((column) => ({
          ...column,
          key: column.key.trim(),
          label: column.label.trim(),
          ...(column.unit ? { unit: column.unit.trim() } : {}),
          ...(column.metadata
            ? { metadata: normalizeSafeMetadata(column.metadata) }
            : {}),
        })),
        ...(input.metadata
          ? { metadata: normalizeSafeMetadata(input.metadata) }
          : {}),
      };
    case "select":
      return {
        ...input,
        key: input.key.trim(),
        label: input.label.trim(),
        options: input.options.map((option) => option.trim()).sort(),
        ...(input.defaultValue ? { defaultValue: input.defaultValue.trim() } : {}),
        ...(input.metadata
          ? { metadata: normalizeSafeMetadata(input.metadata) }
          : {}),
      };
    case "boolean":
      return {
        ...input,
        key: input.key.trim(),
        label: input.label.trim(),
        ...(input.metadata
          ? { metadata: normalizeSafeMetadata(input.metadata) }
          : {}),
      };
    case "text":
      return {
        ...input,
        key: input.key.trim(),
        label: input.label.trim(),
        ...(input.metadata
          ? { metadata: normalizeSafeMetadata(input.metadata) }
          : {}),
      };
  }
}

function normalizeFormula(formula: MethodFormula): MethodFormula {
  return {
    ...formula,
    key: formula.key.trim(),
    label: formula.label.trim(),
    expression: normalizeExpression(formula.expression),
    ...(formula.outputUnit ? { outputUnit: formula.outputUnit.trim() } : {}),
    ...(formula.dependencies
      ? { dependencies: [...new Set(formula.dependencies.map((key) => key.trim()))].sort() }
      : {}),
    ...(formula.metadata
      ? { metadata: normalizeSafeMetadata(formula.metadata) }
      : {}),
  };
}

function normalizeMeasurementModel(
  model: MethodMeasurementModel,
): MethodMeasurementModel {
  return {
    ...model,
    key: model.key.trim(),
    label: model.label.trim(),
    measurand: model.measurand.trim(),
    expression: normalizeExpression(model.expression),
    quantities: model.quantities.map(normalizeQuantity),
    correlations: model.correlations?.map((item) => ({
      symbols: [item.symbols[0].trim(), item.symbols[1].trim()],
      coefficient: item.coefficient,
    })),
    covariances: model.covariances?.map((item) => ({
      symbols: [item.symbols[0].trim(), item.symbols[1].trim()],
      covariance: item.covariance,
    })),
    ...(model.outputUnit ? { outputUnit: model.outputUnit.trim() } : {}),
    ...(model.metadata ? { metadata: normalizeSafeMetadata(model.metadata) } : {}),
  };
}

function normalizeQuantity(quantity: MethodQuantity): MethodQuantity {
  return {
    ...quantity,
    symbol: quantity.symbol.trim(),
    source:
      quantity.source.kind === "constant"
        ? quantity.source
        : { ...quantity.source, key: quantity.source.key.trim() },
    ...(quantity.unit ? { unit: quantity.unit.trim() } : {}),
    ...(quantity.metadata
      ? { metadata: normalizeSafeMetadata(quantity.metadata) }
      : {}),
  };
}

function normalizeAcceptanceCriterion(
  criterion: MethodAcceptanceCriterion,
): MethodAcceptanceCriterion {
  return {
    ...criterion,
    key: criterion.key.trim(),
    label: criterion.label.trim(),
    expression: normalizeExpression(criterion.expression),
    message: criterion.message.trim(),
  };
}

function normalizePreviewScenario(
  scenario: MethodPreviewScenario,
): MethodPreviewScenario {
  return {
    ...scenario,
    key: scenario.key.trim(),
    label: scenario.label.trim(),
  };
}

export function normalizeExpression(expression: string): string {
  return expression.trim().replace(/\s+/g, " ");
}
