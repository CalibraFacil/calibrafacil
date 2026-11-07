import type {
  CompetenceListItem,
  CompetencesListResponse,
  CompetencesMatrixResponse,
} from "./competences";

/**
 * Contract-valid example payloads for the competences endpoints, for tests in
 * any package. `competences.test.ts` parses every builder against its response
 * schema.
 */

export function buildCompetenceListItem(
  overrides: Partial<CompetenceListItem> = {},
): CompetenceListItem {
  return {
    id: 1,
    userId: "user-1",
    userName: "Técnica Alfa",
    assetTypeId: 3,
    assetTypeName: "Manômetro",
    scopeDescription: "Calibração de manômetros",
    status: "ACTIVE",
    qualifiedAt: "2026-01-10T00:00:00.000Z",
    expiresAt: "2027-01-10T00:00:00.000Z",
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function buildCompetencesListResponse(
  data: CompetenceListItem[] = [buildCompetenceListItem()],
): CompetencesListResponse {
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

export function buildCompetencesMatrixResponse(): CompetencesMatrixResponse {
  return {
    technicians: [
      { userId: "user-1", userName: "Técnica Alfa", role: "technician" },
    ],
    assetTypes: [{ id: 3, name: "Manômetro" }],
    competences: [
      {
        id: 1,
        userId: "user-1",
        assetTypeId: 3,
        status: "ACTIVE",
        expiresAt: "2027-01-10T00:00:00.000Z",
      },
    ],
  };
}
