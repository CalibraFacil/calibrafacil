export type MassUnit = "mg" | "g" | "kg";

export const CANONICAL_MASS_UNIT = "g" as const;

export type AssetSpecificationFieldLike = {
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

export type WeighingRangeSpecLike = {
  label?: string | null;
  min?: number | null;
  max?: number | null;
  rangeUnit?: string | null;
  resolution?: number | null;
  resolutionUnit?: string | null;
};

export type MassConversionTrace = {
  fieldPath: string;
  originalValue: number;
  originalUnit: MassUnit;
  normalizedValue: number;
  normalizedUnit: MassUnit;
  reason: string;
};

const MASS_FACTORS_TO_G: Record<MassUnit, number> = {
  mg: 0.001,
  g: 1,
  kg: 1000,
};

function parseNumericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function isMassUnit(unit: unknown): unit is MassUnit {
  return unit === "mg" || unit === "g" || unit === "kg";
}

export function normalizeMassUnit(unit: unknown): MassUnit | null {
  if (typeof unit !== "string") {
    return null;
  }

  const normalized = unit.trim().toLowerCase();
  return isMassUnit(normalized) ? normalized : null;
}

export function convertMassValue(
  value: number,
  fromUnit: unknown,
  toUnit: unknown,
): number | null {
  const normalizedFrom = normalizeMassUnit(fromUnit);
  const normalizedTo = normalizeMassUnit(toUnit);

  if (!normalizedFrom || !normalizedTo) {
    return null;
  }

  return (
    (value * MASS_FACTORS_TO_G[normalizedFrom]) /
    MASS_FACTORS_TO_G[normalizedTo]
  );
}

export function toCanonicalMassValue(
  value: number,
  fromUnit: unknown,
): number | null {
  return convertMassValue(value, fromUnit, CANONICAL_MASS_UNIT);
}

export function fromCanonicalMassValue(
  value: number,
  toUnit: unknown,
): number | null {
  return convertMassValue(value, CANONICAL_MASS_UNIT, toUnit);
}

export function isMassMeasurementUnit(unit: unknown): unit is MassUnit {
  return isMassUnit(unit);
}

export function resolveMassDisplayUnit(
  baseMeasurementUnit: MassUnit | null | undefined,
  literalUnit: string | null | undefined,
): string | undefined {
  if (baseMeasurementUnit && isMassMeasurementUnit(literalUnit)) {
    return baseMeasurementUnit;
  }

  return literalUnit ?? undefined;
}

export function isMassSpecificationField(
  field: AssetSpecificationFieldLike | null | undefined,
): boolean {
  if (!field) return false;
  return field.type === "weighing_ranges" || isMassMeasurementUnit(field.unit);
}

export function isMassMethodField(
  field: MethodInputFieldLike | null | undefined,
): boolean {
  if (!field) return false;
  if (field.type === "number" && isMassMeasurementUnit(field.unit)) {
    return true;
  }

  return (
    field.type === "table" &&
    (field.columns ?? []).some((column) => isMassMeasurementUnit(column.unit))
  );
}

export function isMassMethodFormula(
  formula: MethodFormulaLike | null | undefined,
): boolean {
  return isMassMeasurementUnit(formula?.unit);
}

export function isMassAssetTypeDefinition(
  definition: AssetSpecificationFieldLike[] | null | undefined,
  assetType?: { slug?: string | null; name?: string | null },
): boolean {
  const fields = definition ?? [];
  if (fields.some((field) => isMassSpecificationField(field))) {
    return true;
  }

  const normalizedSlug = String(assetType?.slug ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const normalizedName = String(assetType?.name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return (
    normalizedSlug.includes("balanca") ||
    normalizedSlug.includes("balance") ||
    normalizedSlug.includes("scale") ||
    normalizedName.includes("balanca") ||
    normalizedName.includes("balance") ||
    normalizedName.includes("scale")
  );
}

export function normalizeWeighingRangeSpecsForStorage(
  value: unknown,
  displayUnit: MassUnit | null | undefined,
  fieldPath = "weighingRanges",
): {
  value: unknown;
  conversions: MassConversionTrace[];
} {
  if (!displayUnit || !Array.isArray(value)) {
    return { value, conversions: [] };
  }

  const conversions: MassConversionTrace[] = [];
  const nextRanges = value.map((item, index) => {
    if (!item || typeof item !== "object") {
      return item;
    }

    const range = toRecord(item);
    const nextRange: Record<string, unknown> = {
      ...range,
      rangeUnit: CANONICAL_MASS_UNIT,
      resolutionUnit: CANONICAL_MASS_UNIT,
    };

    for (const key of ["min", "max", "resolution"] as const) {
      const numericValue = parseNumericValue(range[key]);
      if (numericValue == null) {
        nextRange[key] = range[key];
        continue;
      }

      const normalizedValue = toCanonicalMassValue(numericValue, displayUnit);
      if (normalizedValue == null) {
        nextRange[key] = range[key];
        continue;
      }

      nextRange[key] = normalizedValue;
      conversions.push({
        fieldPath: `${fieldPath}[${index}].${key}`,
        originalValue: numericValue,
        originalUnit: displayUnit,
        normalizedValue,
        normalizedUnit: CANONICAL_MASS_UNIT,
        reason: "asset_specification",
      });
    }

    return nextRange;
  });

  return { value: nextRanges, conversions };
}

export function denormalizeWeighingRangeSpecsForDisplay(
  value: unknown,
  displayUnit: MassUnit | null | undefined,
): unknown {
  if (!displayUnit || !Array.isArray(value)) {
    return value;
  }

  return value.map((item) => {
    if (!item || typeof item !== "object") {
      return item;
    }

    const range = toRecord(item);
    const nextRange: Record<string, unknown> = {
      ...range,
      rangeUnit: displayUnit,
      resolutionUnit: displayUnit,
    };

    for (const key of ["min", "max", "resolution"] as const) {
      const numericValue = parseNumericValue(range[key]);
      if (numericValue == null) {
        nextRange[key] = range[key];
        continue;
      }

      nextRange[key] = fromCanonicalMassValue(numericValue, displayUnit);
    }

    return nextRange;
  });
}

export function normalizeAssetSpecificationsForStorage(
  specifications: Record<string, unknown> | null | undefined,
  definition: AssetSpecificationFieldLike[] | null | undefined,
  baseMeasurementUnit: MassUnit | null | undefined,
): {
  specifications: Record<string, unknown> | null | undefined;
  conversions: MassConversionTrace[];
} {
  if (!specifications || !definition?.length || !baseMeasurementUnit) {
    return { specifications, conversions: [] };
  }

  const nextSpecifications: Record<string, unknown> = { ...specifications };
  const conversions: MassConversionTrace[] = [];

  for (const field of definition) {
    const rawValue = specifications[field.key];
    if (rawValue === undefined) {
      continue;
    }

    if (field.type === "weighing_ranges") {
      const normalized = normalizeWeighingRangeSpecsForStorage(
        rawValue,
        baseMeasurementUnit,
        field.key,
      );
      nextSpecifications[field.key] = normalized.value;
      conversions.push(...normalized.conversions);
      continue;
    }

    if (field.type !== "number" || !isMassMeasurementUnit(field.unit)) {
      continue;
    }

    const numericValue = parseNumericValue(rawValue);
    if (numericValue == null) {
      continue;
    }

    const normalizedValue = toCanonicalMassValue(
      numericValue,
      baseMeasurementUnit,
    );
    if (normalizedValue == null) {
      continue;
    }

    nextSpecifications[field.key] = normalizedValue;
    conversions.push({
      fieldPath: field.key,
      originalValue: numericValue,
      originalUnit: baseMeasurementUnit,
      normalizedValue,
      normalizedUnit: CANONICAL_MASS_UNIT,
      reason: "asset_specification",
    });
  }

  return { specifications: nextSpecifications, conversions };
}

export function denormalizeAssetSpecificationsForDisplay(
  specifications: Record<string, unknown> | null | undefined,
  definition: AssetSpecificationFieldLike[] | null | undefined,
  baseMeasurementUnit: MassUnit | null | undefined,
): Record<string, unknown> | null | undefined {
  if (!specifications || !definition?.length || !baseMeasurementUnit) {
    return specifications;
  }

  const nextSpecifications: Record<string, unknown> = { ...specifications };

  for (const field of definition) {
    const rawValue = specifications[field.key];
    if (rawValue === undefined) {
      continue;
    }

    if (field.type === "weighing_ranges") {
      nextSpecifications[field.key] = denormalizeWeighingRangeSpecsForDisplay(
        rawValue,
        baseMeasurementUnit,
      );
      continue;
    }

    if (field.type !== "number" || !isMassMeasurementUnit(field.unit)) {
      continue;
    }

    const numericValue = parseNumericValue(rawValue);
    if (numericValue == null) {
      continue;
    }

    const displayValue = fromCanonicalMassValue(
      numericValue,
      baseMeasurementUnit,
    );
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
  baseMeasurementUnit: MassUnit | null | undefined,
): {
  data: Record<string, unknown> | null | undefined;
  conversions: MassConversionTrace[];
} {
  if (!data || !fields?.length || !baseMeasurementUnit) {
    return { data, conversions: [] };
  }

  const nextData: Record<string, unknown> = { ...data };
  const conversions: MassConversionTrace[] = [];

  for (const field of fields) {
    if (field.source === "asset_spec") {
      continue;
    }

    const rawValue = data[field.key];
    if (rawValue === undefined) {
      continue;
    }

    if (field.type === "number" && isMassMeasurementUnit(field.unit)) {
      const numericValue = parseNumericValue(rawValue);
      if (numericValue == null) {
        continue;
      }

      const normalizedValue = toCanonicalMassValue(
        numericValue,
        baseMeasurementUnit,
      );
      if (normalizedValue == null) {
        continue;
      }

      nextData[field.key] = normalizedValue;
      conversions.push({
        fieldPath: field.key,
        originalValue: numericValue,
        originalUnit: baseMeasurementUnit,
        normalizedValue,
        normalizedUnit: CANONICAL_MASS_UNIT,
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
        if (!isMassMeasurementUnit(column.unit)) {
          continue;
        }

        const numericValue = parseNumericValue(nextRow[column.key]);
        if (numericValue == null) {
          continue;
        }

        const normalizedValue = toCanonicalMassValue(
          numericValue,
          baseMeasurementUnit,
        );
        if (normalizedValue == null) {
          continue;
        }

        nextRow[column.key] = normalizedValue;
        conversions.push({
          fieldPath: `${field.key}[${rowIndex}].${column.key}`,
          originalValue: numericValue,
          originalUnit: baseMeasurementUnit,
          normalizedValue,
          normalizedUnit: CANONICAL_MASS_UNIT,
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
  baseMeasurementUnit: MassUnit | null | undefined,
): Record<string, unknown> | null | undefined {
  if (!data || !fields?.length || !baseMeasurementUnit) {
    return data;
  }

  const nextData: Record<string, unknown> = { ...data };

  for (const field of fields) {
    if (field.source === "asset_spec") {
      continue;
    }

    const rawValue = data[field.key];
    if (rawValue === undefined) {
      continue;
    }

    if (field.type === "number" && isMassMeasurementUnit(field.unit)) {
      const numericValue = parseNumericValue(rawValue);
      if (numericValue == null) {
        continue;
      }

      const displayValue = fromCanonicalMassValue(
        numericValue,
        baseMeasurementUnit,
      );
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
        if (!isMassMeasurementUnit(column.unit)) {
          continue;
        }

        const numericValue = parseNumericValue(nextRow[column.key]);
        if (numericValue == null) {
          continue;
        }

        const displayValue = fromCanonicalMassValue(
          numericValue,
          baseMeasurementUnit,
        );
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
  baseMeasurementUnit: MassUnit | null | undefined,
): Record<string, unknown> | null | undefined {
  if (!results || !formulas?.length || !baseMeasurementUnit) {
    return results;
  }

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

    const displayValue = fromCanonicalMassValue(
      numericValue,
      baseMeasurementUnit,
    );
    return displayValue ?? value;
  };

  for (const [key, rawValue] of Object.entries(results)) {
    const formula = formulaMap.get(key);
    if (!formula || !isMassMethodFormula(formula)) {
      continue;
    }

    nextResults[key] = denormalizeResultValue(rawValue);
  }

  return nextResults;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

export type NormalizableCertifiedValue = {
  value: number;
  uncertainty: number;
  unit: string;
  maxError?: number | null;
  drift?: number | null;
  buoyancy?: number | null;
};

export type NormalizableStandardSnapshot = {
  uncertainty: number | null;
  uncertaintyUnit: string | null;
  drift: number | null;
  certifiedValues: NormalizableCertifiedValue[] | null;
};

function normalizeStandardNumberToGrams(
  value: number | null | undefined,
  unit: unknown,
): { value: number | null | undefined; normalized: boolean } {
  if (value === null || value === undefined) {
    return { value, normalized: false };
  }

  const normalized = toCanonicalMassValue(value, unit);
  return normalized === null
    ? { value, normalized: false }
    : { value: normalized, normalized: true };
}

/**
 * Convert a standards snapshot's certified values, uncertainty and drift to the
 * canonical mass unit (grams) before official execution. This MUST run on every
 * authoritative execution path — cloud (jobs/sync) and offline desktop — so that
 * a non-gram lab gets identical results, acceptance verdicts and certificates
 * online and offline (audit H4). Generic so each caller keeps its own snapshot
 * type; Object.assign preserves all non-mass fields.
 */
export function normalizeStandardsForOfficialExecution<
  T extends NormalizableStandardSnapshot,
>(standards: readonly T[] | null | undefined): T[] | null | undefined {
  if (!standards) {
    return standards;
  }

  return standards.map((standard) => {
    const certifiedValues = standard.certifiedValues?.map((certifiedValue) => {
      const value = normalizeStandardNumberToGrams(
        certifiedValue.value,
        certifiedValue.unit,
      );
      const uncertainty = normalizeStandardNumberToGrams(
        certifiedValue.uncertainty,
        certifiedValue.unit,
      );
      const maxError = normalizeStandardNumberToGrams(
        certifiedValue.maxError,
        certifiedValue.unit,
      );
      const drift = normalizeStandardNumberToGrams(
        certifiedValue.drift,
        certifiedValue.unit,
      );
      const buoyancy = normalizeStandardNumberToGrams(
        certifiedValue.buoyancy,
        certifiedValue.unit,
      );

      return Object.assign({}, certifiedValue, {
        value: value.value ?? certifiedValue.value,
        uncertainty: uncertainty.value ?? certifiedValue.uncertainty,
        unit: value.normalized ? "g" : certifiedValue.unit,
        maxError: maxError.value ?? certifiedValue.maxError,
        drift: drift.value ?? certifiedValue.drift,
        buoyancy: buoyancy.value ?? certifiedValue.buoyancy,
      });
    });

    const driftUnit =
      standard.certifiedValues?.[0]?.unit ?? standard.uncertaintyUnit;
    const normalizedUncertainty = normalizeStandardNumberToGrams(
      standard.uncertainty,
      standard.uncertaintyUnit,
    );
    const normalizedDrift = normalizeStandardNumberToGrams(
      standard.drift,
      driftUnit,
    );

    return Object.assign({}, standard, {
      uncertainty: normalizedUncertainty.value ?? standard.uncertainty,
      uncertaintyUnit: normalizedUncertainty.normalized
        ? "g"
        : standard.uncertaintyUnit,
      drift: normalizedDrift.value ?? standard.drift,
      certifiedValues: certifiedValues ?? null,
    });
  });
}
