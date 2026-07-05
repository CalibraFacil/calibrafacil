/**
 * Adapter from a {@link MethodDraft} to the dimensional checker's generic input.
 *
 * It flattens the method's symbol universe — scalar inputs, repeated-observation
 * inputs, table columns and measurement-model quantities — to `{ symbol, unit }`
 * fields, and its display formulas + measurement models to `{ id, expression,
 * resultUnit }`. The checker then infers and unifies dimensions across them.
 *
 * Acceptance criteria (`==`, `<`, …) are intentionally NOT included: the math
 * engine's grammar has no comparison operators, so those expressions are not
 * dimension-checkable ASTs here.
 */

import type { MethodDraft } from "../types";
import {
  checkMethodDimensions,
  type DimensionalDiagnostic,
  type DimensionalFieldInput,
  type DimensionalFormulaInput,
} from "./check";

function collectFields(draft: MethodDraft): DimensionalFieldInput[] {
  const fields: DimensionalFieldInput[] = [];
  for (const input of draft.inputs) {
    if (input.kind === "scalar" || input.kind === "repeated_observation") {
      fields.push({ symbol: input.key, unit: input.unit });
    } else if (input.kind === "table") {
      for (const column of input.columns) {
        fields.push({ symbol: column.key, unit: column.unit });
      }
    }
  }
  return fields;
}

function collectQuantities(draft: MethodDraft): DimensionalFieldInput[] {
  const quantities: DimensionalFieldInput[] = [];
  for (const model of draft.measurementModels) {
    for (const quantity of model.quantities) {
      quantities.push({ symbol: quantity.symbol, unit: quantity.unit });
    }
  }
  return quantities;
}

function collectFormulas(draft: MethodDraft): DimensionalFormulaInput[] {
  const formulas: DimensionalFormulaInput[] = [];
  for (const formula of draft.formulas) {
    formulas.push({
      id: formula.key,
      expression: formula.expression,
      resultUnit: formula.outputUnit,
    });
  }
  for (const model of draft.measurementModels) {
    formulas.push({
      id: model.key,
      expression: model.expression,
      resultUnit: model.outputUnit,
      resultSymbol: model.measurand,
    });
  }
  return formulas;
}

/**
 * Run the dimensional checker over a compiled method draft. Returns an empty
 * array when the method is dimensionally coherent.
 */
export function checkMethodDraftDimensions(
  draft: MethodDraft,
): DimensionalDiagnostic[] {
  return checkMethodDimensions({
    fields: collectFields(draft),
    quantities: collectQuantities(draft),
    formulas: collectFormulas(draft),
  });
}
