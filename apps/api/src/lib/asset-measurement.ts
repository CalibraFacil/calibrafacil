import type { AssetTypeFieldDefinition } from "@calibra-facil/db/schema";
import {
  isMassAssetTypeDefinition,
  normalizeUnitToken,
  unitKind,
  type MeasurementUnit,
} from "@calibra-facil/shared";
import {
  denormalizeSpecificationsForDisplay,
  normalizeSpecificationsForStorage,
  type UnitConversionTrace,
} from "@calibra-facil/shared/units";

type AssetTypeDescriptor = {
  definition: AssetTypeFieldDefinition[] | null | undefined;
  slug?: string | null;
  name?: string | null;
};

export function assetTypeRequiresMassBaseUnit(
  assetType: AssetTypeDescriptor,
): boolean {
  return isMassAssetTypeDefinition(assetType.definition, assetType);
}

/**
 * Resolve the asset's base measurement unit from request input. The API only
 * validates registry membership (kind-matching is a UI concern): any valid
 * registry token is accepted and stored. Mass asset types keep their hard
 * requirement of a mass unit for back-compat.
 */
export function resolveAssetBaseMeasurementUnit(
  assetType: AssetTypeDescriptor,
  requestedBaseMeasurementUnit: unknown,
):
  | {
      ok: true;
      baseMeasurementUnit: MeasurementUnit | null;
    }
  | {
      ok: false;
      error: string;
    } {
  const normalizedUnit = normalizeUnitToken(requestedBaseMeasurementUnit);

  if (assetTypeRequiresMassBaseUnit(assetType)) {
    if (!normalizedUnit || unitKind(normalizedUnit) !== "mass") {
      return {
        ok: false,
        error:
          "Selecione a unidade base do instrumento (kg, g ou mg) para ativos de massa",
      };
    }
    return { ok: true, baseMeasurementUnit: normalizedUnit };
  }

  return { ok: true, baseMeasurementUnit: normalizedUnit };
}

export function normalizeAssetSpecificationsFromInput(params: {
  specifications: Record<string, unknown> | null | undefined;
  definition: AssetTypeFieldDefinition[] | null | undefined;
  baseMeasurementUnit: MeasurementUnit | null | undefined;
}): {
  specifications: Record<string, unknown> | null | undefined;
  conversions: UnitConversionTrace[];
} {
  return normalizeSpecificationsForStorage(
    params.specifications,
    params.definition,
    params.baseMeasurementUnit,
  );
}

export function denormalizeAssetSpecificationsForResponse(params: {
  specifications: Record<string, unknown> | null | undefined;
  definition: AssetTypeFieldDefinition[] | null | undefined;
  baseMeasurementUnit: MeasurementUnit | null | undefined;
}): Record<string, unknown> | null | undefined {
  return denormalizeSpecificationsForDisplay(
    params.specifications,
    params.definition,
    params.baseMeasurementUnit,
  );
}
