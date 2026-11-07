import type { AssetDetail, AssetRecord, AssetsListResponse } from "./assets";

/**
 * Contract-valid example payloads for the assets endpoints, for tests in any
 * package. Every value mirrors what the handlers return today; `assets.test.ts`
 * parses every builder against its response schema.
 */

export function buildAssetRecord(
  overrides: Partial<AssetRecord> = {},
): AssetRecord {
  return {
    id: 1,
    customerId: 1,
    assetTypeId: 2,
    name: "Balança de bancada",
    manufacturer: "Toledo",
    model: "Prix 3",
    serialNumber: "SN-1",
    tag: "TAG-1",
    status: "ACTIVE",
    baseMeasurementUnit: "kg",
    specifications: null,
    lastCalibrationDate: null,
    nextCalibrationDate: null,
    comments: null,
    metrologyRegime: "INDUSTRIAL",
    createdAt: "2026-01-10T12:00:00.000Z",
    updatedAt: "2026-01-10T12:00:00.000Z",
    ...overrides,
  };
}

export function buildAssetsListResponse(
  data: AssetRecord[] = [buildAssetRecord()],
): AssetsListResponse {
  return {
    data: data.map((record) => ({
      ...record,
      customerName: "Metalúrgica Alfa Ltda",
      customerTaxId: "12.345.678/0001-90",
      assetTypeName: "Balança",
      assetTypeSlug: "balanca",
      assetTypeDefinition: [],
    })),
    pagination: {
      page: 1,
      limit: 20,
      total: data.length,
      totalPages: data.length === 0 ? 0 : 1,
    },
  };
}

export function buildAssetDetail(
  overrides: Partial<AssetDetail> = {},
): AssetDetail {
  const [item] = buildAssetsListResponse().data;
  if (!item) throw new Error("buildAssetDetail: no list item");
  return {
    ...item,
    installedAt: null,
    regulatedInterval: null,
    nextLegalVerificationDate: null,
    ...overrides,
  };
}
