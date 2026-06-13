/**
 * Mass-unit back-compat layer.
 *
 * Every export here keeps its original name and signature but now delegates to
 * the kind-aware unit registry in `./units` with mass pinned. This keeps mass
 * behaviour byte-identical (factor-only conversions, canonical = grams) while
 * the rest of the codebase migrates onto the generic API. For non-mass kinds,
 * import directly from `@calibra-facil/shared/units`.
 */

import {
  type SpecificationFieldLike,
  type MethodInputFieldLike,
  type MethodFormulaLike,
  type UnitConversionTrace,
  convertUnitValue,
  resolveDisplayUnit,
  normalizeSpecificationsForStorage,
  denormalizeSpecificationsForDisplay,
  normalizeMethodDataForStorage as genNormalizeMethodDataForStorage,
  denormalizeMethodDataForDisplay as genDenormalizeMethodDataForDisplay,
  denormalizeMethodResultsForDisplay as genDenormalizeMethodResultsForDisplay,
  normalizeRangeSpecsForStorage,
  normalizeRangeSpecsForDisplay,
} from "./units";

export type MassUnit = "mg" | "g" | "kg";

export const CANONICAL_MASS_UNIT = "g" as const;

export type AssetSpecificationFieldLike = SpecificationFieldLike;

export type MassConversionTrace = UnitConversionTrace;

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

  return convertUnitValue(value, normalizedFrom, normalizedTo);
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
  return resolveDisplayUnit(baseMeasurementUnit, literalUnit);
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
  return normalizeRangeSpecsForStorage(value, displayUnit, fieldPath);
}

export function denormalizeWeighingRangeSpecsForDisplay(
  value: unknown,
  displayUnit: MassUnit | null | undefined,
): unknown {
  return normalizeRangeSpecsForDisplay(value, displayUnit);
}

export function normalizeAssetSpecificationsForStorage(
  specifications: Record<string, unknown> | null | undefined,
  definition: AssetSpecificationFieldLike[] | null | undefined,
  baseMeasurementUnit: MassUnit | null | undefined,
): {
  specifications: Record<string, unknown> | null | undefined;
  conversions: MassConversionTrace[];
} {
  return normalizeSpecificationsForStorage(
    specifications,
    definition,
    baseMeasurementUnit,
  );
}

export function denormalizeAssetSpecificationsForDisplay(
  specifications: Record<string, unknown> | null | undefined,
  definition: AssetSpecificationFieldLike[] | null | undefined,
  baseMeasurementUnit: MassUnit | null | undefined,
): Record<string, unknown> | null | undefined {
  return denormalizeSpecificationsForDisplay(
    specifications,
    definition,
    baseMeasurementUnit,
  );
}

export function normalizeMethodDataForStorage(
  data: Record<string, unknown> | null | undefined,
  fields: MethodInputFieldLike[] | null | undefined,
  baseMeasurementUnit: MassUnit | null | undefined,
): {
  data: Record<string, unknown> | null | undefined;
  conversions: MassConversionTrace[];
} {
  return genNormalizeMethodDataForStorage(data, fields, baseMeasurementUnit);
}

export function denormalizeMethodDataForDisplay(
  data: Record<string, unknown> | null | undefined,
  fields: MethodInputFieldLike[] | null | undefined,
  baseMeasurementUnit: MassUnit | null | undefined,
): Record<string, unknown> | null | undefined {
  return genDenormalizeMethodDataForDisplay(data, fields, baseMeasurementUnit);
}

export function denormalizeMethodResultsForDisplay(
  results: Record<string, unknown> | null | undefined,
  formulas: MethodFormulaLike[] | null | undefined,
  baseMeasurementUnit: MassUnit | null | undefined,
): Record<string, unknown> | null | undefined {
  return genDenormalizeMethodResultsForDisplay(
    results,
    formulas,
    baseMeasurementUnit,
  );
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
