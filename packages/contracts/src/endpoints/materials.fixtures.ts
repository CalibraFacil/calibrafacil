import type { MaterialRecord, MaterialsListResponse } from "./materials";

/**
 * Contract-valid example payloads for the materials endpoints, for tests in any
 * package. `materials.test.ts` parses every builder against its response schema.
 */

export function buildMaterialRecord(
  overrides: Partial<MaterialRecord> = {},
): MaterialRecord {
  return {
    id: 1,
    name: "Célula de carga 50kg",
    description: null,
    sku: "CEL-50",
    unit: "un",
    unitCostCents: 12000,
    unitPriceCents: 18000,
    controlsStock: false,
    stockQuantity: null,
    stockSyncedAt: null,
    isActive: true,
    createdAt: "2026-01-10T12:00:00.000Z",
    updatedAt: "2026-01-10T12:00:00.000Z",
    ...overrides,
  };
}

export function buildMaterialsListResponse(
  data: MaterialRecord[] = [buildMaterialRecord()],
): MaterialsListResponse {
  return {
    data,
    pagination: {
      page: 1,
      limit: 20,
      total: data.length,
      totalPages: data.length === 0 ? 0 : 1,
    },
  };
}
