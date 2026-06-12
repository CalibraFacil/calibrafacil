/**
 * Quantity-kind-aware normalization of asset specifications, method input data
 * and method results between an asset's display (base) unit and the canonical
 * storage unit for each kind.
 *
 * Generalizes the mass-only helpers in `mass-units.ts` (which now delegate
 * here with mass pinned). The rule is uniform across every kind:
 *
 *  - A field/column/formula is converted only when its unit's kind matches the
 *    asset's base-unit kind. Unit-less fields and other-kind fields are left
 *    untouched (this is exactly today's mass behaviour, and gives a
 *    termohigrômetro "%RH untouched, °C converted" for free).
 *  - Absolute values (measured/indicated/nominal, range bounds) use
 *    {@link convertUnitValue}; range *widths* (resolution) use
 *    {@link convertUnitDelta} so affine kinds stay correct.
 */

import {
  type MeasurementUnit,
  type QuantityKind,
  canonicalUnitFor,
  unitKind,
} from "./registry";
import {
  convertUnitDelta,
  convertUnitValue,
  parseNumericValue,
} from "./convert";

export type SpecificationFieldLike = {
  key: string;
  type: "text" | "number" | "select" | "weighing_ranges";
  unit?: string | null;
};

export type MethodTableColumnLike = {
  key: string;
  type: "text" | "number";
  unit?: string | null;
};

export type MethodInputFieldLike = {
  key: string;
  type: "text" | "number" | "select" | "table";
  unit?: string | null;
  source?: string | null;
  columns?: MethodTableColumnLike[] | null;
};

export type MethodFormulaLike = {
  outputKey: string;
  unit?: string | null;
};

export type RangeSpecLike = {
  label?: string | null;
  min?: number | null;
  max?: number | null;
  rangeUnit?: string | null;
  resolution?: number | null;
  resolutionUnit?: string | null;
};

export type UnitConversionTrace = {
  fieldPath: string;
  originalValue: number;
  originalUnit: string;
  normalizedValue: number;
  normalizedUnit: string;
  reason: string;
};

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value));
}

/**
 * The display unit a literal column/field value should be presented in: the
 * asset's base unit when both share a kind, otherwise the literal unit. Mirrors
 * the former `resolveMassDisplayUnit`.
 */
export function resolveDisplayUnit(
  baseUnit: string | null | undefined,
  literalUnit: string | null | undefined,
): string | undefined {
  const baseKind = unitKind(baseUnit);
  const literalKind = unitKind(literalUnit);
  if (baseUnit && baseKind && literalKind && baseKind === literalKind) {
    return baseUnit;
  }
  return literalUnit ?? undefined;
}

/**
 * The dominant quantity kind across an asset type's field definition, used to
 * pre-filter the unit picker in the asset form. `weighing_ranges` fields count
 * as mass. Returns `null` when no field carries a recognizable unit.
 */
export function dominantKindForAssetType(
  fields: SpecificationFieldLike[] | null | undefined,
): QuantityKind | null {
  const counts = new Map<QuantityKind, number>();
  for (const field of fields ?? []) {
    const kind =
      field.type === "weighing_ranges" ? "mass" : unitKind(field.unit);
    if (kind) {
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
  }

  let best: QuantityKind | null = null;
  let bestCount = 0;
  for (const [kind, count] of counts) {
    if (count > bestCount) {
      best = kind;
      bestCount = count;
    }
  }
  return best;
}

type ConvertMode = "absolute" | "delta";

function denormalize(
  value: number,
  canonical: MeasurementUnit,
  displayUnit: string,
  mode: ConvertMode,
): number | null {
  return mode === "delta"
    ? convertUnitDelta(value, canonical, displayUnit)
    : convertUnitValue(value, canonical, displayUnit);
}

function normalizeToCanonical(
  value: number,
  displayUnit: string,
  canonical: MeasurementUnit,
  mode: ConvertMode,
): number | null {
  return mode === "delta"
    ? convertUnitDelta(value, displayUnit, canonical)
    : convertUnitValue(value, displayUnit, canonical);
}

export function normalizeRangeSpecsForStorage(
  value: unknown,
  baseUnit: string | null | undefined,
  fieldPath = "ranges",
): { value: unknown; conversions: UnitConversionTrace[] } {
  const baseKind = unitKind(baseUnit);
  if (!baseUnit || !baseKind || !Array.isArray(value)) {
    return { value, conversions: [] };
  }

  const canonical = canonicalUnitFor(baseKind);
  const conversions: UnitConversionTrace[] = [];
  const nextRanges = value.map((item, index) => {
    if (!item || typeof item !== "object") {
      return item;
    }

    const range = toRecord(item);
    const nextRange: Record<string, unknown> = {
      ...range,
      rangeUnit: canonical,
      resolutionUnit: canonical,
    };

    const fields: Array<{ key: "min" | "max" | "resolution"; mode: ConvertMode }> =
      [
        { key: "min", mode: "absolute" },
        { key: "max", mode: "absolute" },
        { key: "resolution", mode: "delta" },
      ];

    for (const { key, mode } of fields) {
      const numericValue = parseNumericValue(range[key]);
      if (numericValue == null) {
        nextRange[key] = range[key];
        continue;
      }

      const normalizedValue = normalizeToCanonical(
        numericValue,
        baseUnit,
        canonical,
        mode,
      );
      if (normalizedValue == null) {
        nextRange[key] = range[key];
        continue;
      }

      nextRange[key] = normalizedValue;
      conversions.push({
        fieldPath: `${fieldPath}[${index}].${key}`,
        originalValue: numericValue,
        originalUnit: baseUnit,
        normalizedValue,
        normalizedUnit: canonical,
        reason: "asset_specification",
      });
    }

    return nextRange;
  });

  return { value: nextRanges, conversions };
}

export function normalizeRangeSpecsForDisplay(
  value: unknown,
  baseUnit: string | null | undefined,
): unknown {
  const baseKind = unitKind(baseUnit);
  if (!baseUnit || !baseKind || !Array.isArray(value)) {
    return value;
  }

  const canonical = canonicalUnitFor(baseKind);
  return value.map((item) => {
    if (!item || typeof item !== "object") {
      return item;
    }

    const range = toRecord(item);
    const nextRange: Record<string, unknown> = {
      ...range,
      rangeUnit: baseUnit,
      resolutionUnit: baseUnit,
    };

    const fields: Array<{ key: "min" | "max" | "resolution"; mode: ConvertMode }> =
      [
        { key: "min", mode: "absolute" },
        { key: "max", mode: "absolute" },
        { key: "resolution", mode: "delta" },
      ];

    for (const { key, mode } of fields) {
      const numericValue = parseNumericValue(range[key]);
      if (numericValue == null) {
        nextRange[key] = range[key];
        continue;
      }
      const displayValue = denormalize(numericValue, canonical, baseUnit, mode);
      nextRange[key] = displayValue ?? range[key];
    }

    return nextRange;
  });
}

export function normalizeSpecificationsForStorage(
  specifications: Record<string, unknown> | null | undefined,
  definition: SpecificationFieldLike[] | null | undefined,
  baseUnit: string | null | undefined,
): {
  specifications: Record<string, unknown> | null | undefined;
  conversions: UnitConversionTrace[];
} {
  const baseKind = unitKind(baseUnit);
  if (!specifications || !definition?.length || !baseUnit || !baseKind) {
    return { specifications, conversions: [] };
  }

  const canonical = canonicalUnitFor(baseKind);
  const nextSpecifications: Record<string, unknown> = { ...specifications };
  const conversions: UnitConversionTrace[] = [];

  for (const field of definition) {
    const rawValue = specifications[field.key];
    if (rawValue === undefined) {
      continue;
    }

    if (field.type === "weighing_ranges") {
      const normalized = normalizeRangeSpecsForStorage(
        rawValue,
        baseUnit,
        field.key,
      );
      nextSpecifications[field.key] = normalized.value;
      conversions.push(...normalized.conversions);
      continue;
    }

    if (field.type !== "number" || unitKind(field.unit) !== baseKind) {
      continue;
    }

    const numericValue = parseNumericValue(rawValue);
    if (numericValue == null) {
      continue;
    }

    const normalizedValue = convertUnitValue(numericValue, baseUnit, canonical);
    if (normalizedValue == null) {
      continue;
    }

    nextSpecifications[field.key] = normalizedValue;
    conversions.push({
      fieldPath: field.key,
      originalValue: numericValue,
      originalUnit: baseUnit,
      normalizedValue,
      normalizedUnit: canonical,
      reason: "asset_specification",
    });
  }

  return { specifications: nextSpecifications, conversions };
}

export function denormalizeSpecificationsForDisplay(
  specifications: Record<string, unknown> | null | undefined,
  definition: SpecificationFieldLike[] | null | undefined,
  baseUnit: string | null | undefined,
): Record<string, unknown> | null | undefined {
  const baseKind = unitKind(baseUnit);
  if (!specifications || !definition?.length || !baseUnit || !baseKind) {
    return specifications;
  }

  const canonical = canonicalUnitFor(baseKind);
  const nextSpecifications: Record<string, unknown> = { ...specifications };

  for (const field of definition) {
    const rawValue = specifications[field.key];
    if (rawValue === undefined) {
      continue;
    }

    if (field.type === "weighing_ranges") {
      nextSpecifications[field.key] = normalizeRangeSpecsForDisplay(
        rawValue,
        baseUnit,
      );
      continue;
    }

    if (field.type !== "number" || unitKind(field.unit) !== baseKind) {
      continue;
    }

    const numericValue = parseNumericValue(rawValue);
    if (numericValue == null) {
      continue;
    }

    const displayValue = convertUnitValue(numericValue, canonical, baseUnit);
    if (displayValue == null) {
      continue;
    }

    nextSpecifications[field.key] = displayValue;
  }

  return nextSpecifications;
}

export function normalizeMethodDataForStorage(
  data: Record<string, unknown> | null | undefined,
  fields: MethodInputFieldLike[] | null | undefined,
  baseUnit: string | null | undefined,
): {
  data: Record<string, unknown> | null | undefined;
  conversions: UnitConversionTrace[];
} {
  const baseKind = unitKind(baseUnit);
  if (!data || !fields?.length || !baseUnit || !baseKind) {
    return { data, conversions: [] };
  }

  const canonical = canonicalUnitFor(baseKind);
  const nextData: Record<string, unknown> = { ...data };
  const conversions: UnitConversionTrace[] = [];

  for (const field of fields) {
    if (field.source === "asset_spec") {
      continue;
    }

    const rawValue = data[field.key];
    if (rawValue === undefined) {
      continue;
    }

    if (field.type === "number" && unitKind(field.unit) === baseKind) {
      const numericValue = parseNumericValue(rawValue);
      if (numericValue == null) {
        continue;
      }

      const normalizedValue = convertUnitValue(
        numericValue,
        baseUnit,
        canonical,
      );
      if (normalizedValue == null) {
        continue;
      }

      nextData[field.key] = normalizedValue;
      conversions.push({
        fieldPath: field.key,
        originalValue: numericValue,
        originalUnit: baseUnit,
        normalizedValue,
        normalizedUnit: canonical,
        reason: "job_input",
      });
      continue;
    }

    if (field.type !== "table" || !Array.isArray(rawValue) || !field.columns) {
      continue;
    }

    nextData[field.key] = rawValue.map((row, rowIndex) => {
      if (!row || typeof row !== "object") {
        return row;
      }

      const nextRow = toRecord(row);

      for (const column of field.columns ?? []) {
        if (unitKind(column.unit) !== baseKind) {
          continue;
        }

        const numericValue = parseNumericValue(nextRow[column.key]);
        if (numericValue == null) {
          continue;
        }

        const normalizedValue = convertUnitValue(
          numericValue,
          baseUnit,
          canonical,
        );
        if (normalizedValue == null) {
          continue;
        }

        nextRow[column.key] = normalizedValue;
        conversions.push({
          fieldPath: `${field.key}[${rowIndex}].${column.key}`,
          originalValue: numericValue,
          originalUnit: baseUnit,
          normalizedValue,
          normalizedUnit: canonical,
          reason: "job_input",
        });
      }

      return nextRow;
    });
  }

  return { data: nextData, conversions };
}

export function denormalizeMethodDataForDisplay(
  data: Record<string, unknown> | null | undefined,
  fields: MethodInputFieldLike[] | null | undefined,
  baseUnit: string | null | undefined,
): Record<string, unknown> | null | undefined {
  const baseKind = unitKind(baseUnit);
  if (!data || !fields?.length || !baseUnit || !baseKind) {
    return data;
  }

  const canonical = canonicalUnitFor(baseKind);
  const nextData: Record<string, unknown> = { ...data };

  for (const field of fields) {
    if (field.source === "asset_spec") {
      continue;
    }

    const rawValue = data[field.key];
    if (rawValue === undefined) {
      continue;
    }

    if (field.type === "number" && unitKind(field.unit) === baseKind) {
      const numericValue = parseNumericValue(rawValue);
      if (numericValue == null) {
        continue;
      }

      const displayValue = convertUnitValue(numericValue, canonical, baseUnit);
      if (displayValue != null) {
        nextData[field.key] = displayValue;
      }
      continue;
    }

    if (field.type !== "table" || !Array.isArray(rawValue) || !field.columns) {
      continue;
    }

    nextData[field.key] = rawValue.map((row) => {
      if (!row || typeof row !== "object") {
        return row;
      }

      const nextRow = toRecord(row);

      for (const column of field.columns ?? []) {
        if (unitKind(column.unit) !== baseKind) {
          continue;
        }

        const numericValue = parseNumericValue(nextRow[column.key]);
        if (numericValue == null) {
          continue;
        }

        const displayValue = convertUnitValue(numericValue, canonical, baseUnit);
        if (displayValue != null) {
          nextRow[column.key] = displayValue;
        }
      }

      return nextRow;
    });
  }

  return nextData;
}

export function denormalizeMethodResultsForDisplay(
  results: Record<string, unknown> | null | undefined,
  formulas: MethodFormulaLike[] | null | undefined,
  baseUnit: string | null | undefined,
): Record<string, unknown> | null | undefined {
  const baseKind = unitKind(baseUnit);
  if (!results || !formulas?.length || !baseUnit || !baseKind) {
    return results;
  }

  const canonical = canonicalUnitFor(baseKind);
  const formulaMap = new Map(
    formulas.map((formula) => [formula.outputKey, formula]),
  );
  const nextResults: Record<string, unknown> = { ...results };

  const denormalizeResultValue = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map((item) => denormalizeResultValue(item));
    }

    const numericValue = parseNumericValue(value);
    if (numericValue == null) {
      return value;
    }

    const displayValue = convertUnitValue(numericValue, canonical, baseUnit);
    return displayValue ?? value;
  };

  for (const [key, rawValue] of Object.entries(results)) {
    const formula = formulaMap.get(key);
    if (!formula || unitKind(formula.unit) !== baseKind) {
      continue;
    }

    nextResults[key] = denormalizeResultValue(rawValue);
  }

  return nextResults;
}
