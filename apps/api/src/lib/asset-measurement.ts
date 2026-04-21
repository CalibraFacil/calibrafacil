import type { AssetTypeFieldDefinition } from "@calibra-facil/db/schema";
import {
  denormalizeAssetSpecificationsForDisplay,
  isMassAssetTypeDefinition,
  normalizeAssetSpecificationsForStorage,
  normalizeMassUnit,
  type MassConversionTrace,
  type MassUnit,
} from "@calibra-facil/shared";

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

export function resolveAssetBaseMeasurementUnit(
  assetType: AssetTypeDescriptor,
  requestedBaseMeasurementUnit: unknown,
):
  | {
      ok: true;
      baseMeasurementUnit: MassUnit | null;
    }
  | {
      ok: false;
      error: string;
    } {
  const normalizedUnit = normalizeMassUnit(requestedBaseMeasurementUnit);

  if (!assetTypeRequiresMassBaseUnit(assetType)) {
    return { ok: true, baseMeasurementUnit: null };
  }

  if (!normalizedUnit) {
    return {
      ok: false,
      error:
        "Selecione a unidade base do instrumento (kg, g ou mg) para ativos de massa",
    };
  }

  return { ok: true, baseMeasurementUnit: normalizedUnit };
}

export function normalizeAssetSpecificationsFromInput(params: {
  specifications: Record<string, unknown> | null | undefined;
  definition: AssetTypeFieldDefinition[] | null | undefined;
  baseMeasurementUnit: MassUnit | null | undefined;
}): {
  specifications: Record<string, unknown> | null | undefined;
  conversions: MassConversionTrace[];
} {
  return normalizeAssetSpecificationsForStorage(
    params.specifications,
    params.definition,
    params.baseMeasurementUnit,
  );
}

export function denormalizeAssetSpecificationsForResponse(params: {
  specifications: Record<string, unknown> | null | undefined;
  definition: AssetTypeFieldDefinition[] | null | undefined;
  baseMeasurementUnit: MassUnit | null | undefined;
}): Record<string, unknown> | null | undefined {
  return denormalizeAssetSpecificationsForDisplay(
    params.specifications,
    params.definition,
    params.baseMeasurementUnit,
  );
}
