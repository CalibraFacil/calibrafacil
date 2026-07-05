/**
 * Adapter from a raw method *record* (the persisted DB shape and the
 * create/update request payloads — `dataFields` / `formulas` /
 * `measurementModels` / `variableBindings`) to the dimensional checker's generic
 * input.
 *
 * Unlike {@link ./method-adapter}, which consumes an already-parsed
 * {@link MethodDraft}, this adapter is deliberately TOLERANT: it never throws on
 * partial/undefined units or on incomplete draft rows. A missing or unparseable
 * unit simply becomes a wildcard inside the checker (sound — never a false
 * positive). This is what lets the same code path serve the write-time gate
 * (create/update/publish) and the read-only audit of already-stored methods.
 */

import {
  checkMethodDimensions,
  type CheckMethodDimensionsInput,
  type DimensionalDiagnostic,
  type DimensionalFieldInput,
  type DimensionalFormulaInput,
} from "./check";

export interface MethodDimensionalRecord {
  readonly dataFields?: unknown;
  readonly variableBindings?: unknown;
  readonly formulas?: unknown;
  readonly measurementModels?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function unitOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Flatten a raw method record's declared symbols and formulas into a
 * {@link CheckMethodDimensionsInput}. Mirrors the {@link MethodDraft} adapter's
 * coverage (scalar/table inputs, measurement-model quantities, display formulas
 * and measurement-model formulas) but from the untyped persisted/payload shape.
 */
export function dimensionalInputFromMethodRecord(
  record: MethodDimensionalRecord,
): CheckMethodDimensionsInput {
  const fields: DimensionalFieldInput[] = [];
  const quantities: DimensionalFieldInput[] = [];
  const formulas: DimensionalFormulaInput[] = [];

  if (Array.isArray(record.dataFields)) {
    for (const raw of record.dataFields) {
      if (!isRecord(raw)) continue;
      if (raw.type === "table" && Array.isArray(raw.columns)) {
        for (const column of raw.columns) {
          if (!isRecord(column)) continue;
          const columnKey = nonEmptyString(column.key);
          if (columnKey) {
            fields.push({ symbol: columnKey, unit: unitOrNull(column.unit) });
          }
        }
        continue;
      }
      const key = nonEmptyString(raw.key);
      if (key) fields.push({ symbol: key, unit: unitOrNull(raw.unit) });
    }
  }

  if (Array.isArray(record.measurementModels)) {
    for (const raw of record.measurementModels) {
      if (!isRecord(raw) || !Array.isArray(raw.quantities)) continue;
      for (const quantity of raw.quantities) {
        if (!isRecord(quantity)) continue;
        const symbol = nonEmptyString(quantity.symbol);
        if (symbol) {
          quantities.push({ symbol, unit: unitOrNull(quantity.unit) });
        }
      }
    }
  }

  if (Array.isArray(record.formulas)) {
    for (const raw of record.formulas) {
      if (!isRecord(raw)) continue;
      const id = nonEmptyString(raw.outputKey) ?? nonEmptyString(raw.key);
      const expression = nonEmptyString(raw.expression);
      if (id && expression) {
        formulas.push({
          id,
          expression,
          resultUnit: unitOrNull(raw.unit) ?? unitOrNull(raw.outputUnit),
        });
      }
    }
  }

  if (Array.isArray(record.measurementModels)) {
    for (const raw of record.measurementModels) {
      if (!isRecord(raw)) continue;
      const id = nonEmptyString(raw.key);
      const expression = nonEmptyString(raw.expression);
      if (id && expression) {
        formulas.push({
          id,
          expression,
          resultUnit: unitOrNull(raw.outputUnit),
          resultSymbol: nonEmptyString(raw.measurand),
        });
      }
    }
  }

  return { fields, quantities, formulas };
}

/**
 * Run the dimensional checker over a raw method record. Returns an empty array
 * when the method is dimensionally coherent (or has nothing to check).
 */
export function checkMethodRecordDimensions(
  record: MethodDimensionalRecord,
): DimensionalDiagnostic[] {
  return checkMethodDimensions(dimensionalInputFromMethodRecord(record));
}
