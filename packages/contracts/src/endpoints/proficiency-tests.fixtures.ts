import type {
  PtDetail,
  PtListResponse,
  PtPlanItem,
  PtRound,
  PtSummary,
} from "./proficiency-tests";

/**
 * Contract-valid example payloads for the proficiency-tests endpoints, for tests
 * in any package. `proficiency-tests.test.ts` parses every builder against its
 * response schema.
 */

export function buildPtRound(overrides: Partial<PtRound> = {}): PtRound {
  return {
    id: 1,
    activityType: "proficiency_test",
    provider: "Provedor Alfa",
    providerAccreditation: null,
    ptRound: "PT-2026-01",
    scopePart: "Massa",
    metrologyKind: "mass",
    standardId: null,
    standardName: null,
    registrationDate: null,
    participationDate: null,
    resultReportedAt: null,
    overallStatus: "pending",
    capaId: null,
    createdAt: "2026-01-10T12:00:00.000Z",
    updatedAt: "2026-01-10T12:00:00.000Z",
    ...overrides,
  };
}

export function buildPtListResponse(
  data: PtRound[] = [buildPtRound()],
): PtListResponse {
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

export function buildPtDetail(overrides: Partial<PtDetail> = {}): PtDetail {
  return {
    ...buildPtRound(),
    results: [
      {
        label: "100 g",
        unit: "g",
        labValue: 100.001,
        labUncertainty: 0.002,
        refValue: 100,
        refUncertainty: 0.002,
        sigmaPt: null,
        scoreType: "en",
        score: 0.35,
        verdict: "satisfactory",
      },
    ],
    notes: null,
    createdBy: "user-1",
    createdByName: "Técnica Alfa",
    ...overrides,
  };
}

export function buildPtSummary(): PtSummary {
  return {
    total: 3,
    pending: 1,
    satisfactory: 2,
    questionable: 0,
    unsatisfactory: 0,
    planItems: 1,
    planOverdue: 0,
    planDueSoon: 1,
  };
}

export function buildPtPlanItem(
  overrides: Partial<PtPlanItem> = {},
): PtPlanItem {
  return {
    id: 1,
    scopePart: "Massa",
    riskJustification: null,
    frequencyMonths: 48,
    lastSatisfactoryAt: null,
    nextDueAt: "2026-06-01T00:00:00.000Z",
    createdAt: "2026-01-10T12:00:00.000Z",
    updatedAt: "2026-01-10T12:00:00.000Z",
    ...overrides,
  };
}
