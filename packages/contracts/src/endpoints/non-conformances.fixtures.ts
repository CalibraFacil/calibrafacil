import type {
  NonConformanceListItem,
  NonConformanceListResponse,
  NonConformanceRecord,
} from "./non-conformances";

/**
 * Contract-valid example payloads for the non-conformances endpoints, for tests
 * in any package. `non-conformances.test.ts` parses every builder against its
 * response schema.
 */

export function buildNonConformanceRecord(
  overrides: Partial<NonConformanceRecord> = {},
): NonConformanceRecord {
  return {
    id: 1,
    ncNumber: "NC-2026-001",
    organizationId: "org-1",
    jobId: null,
    type: "work",
    triggerSource: "manual",
    description: "Leitura fora da faixa esperada",
    detectedBy: "user-1",
    detectedAt: "2026-05-20T12:00:00.000Z",
    disposition: null,
    dispositionJustification: null,
    dispositionApprovedBy: null,
    dispositionApprovedAt: null,
    correctionTaken: null,
    resolvedAt: null,
    resolvedBy: null,
    status: "open",
    capaId: null,
    createdBy: "user-1",
    createdAt: "2026-05-20T12:00:00.000Z",
    updatedAt: "2026-05-20T12:00:00.000Z",
    ...overrides,
  };
}

export function buildNonConformanceListItem(
  overrides: Partial<NonConformanceListItem> = {},
): NonConformanceListItem {
  const {
    organizationId: _organizationId,
    createdBy: _createdBy,
    triggerSource: _triggerSource,
    ...row
  } = buildNonConformanceRecord();
  return { ...row, detectedByName: "Técnica Alfa", ageDays: 3, ...overrides };
}

export function buildNonConformanceListResponse(
  data: NonConformanceListItem[] = [buildNonConformanceListItem()],
): NonConformanceListResponse {
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
