import type {
  TrainingRecordListItem,
  TrainingRecordsListResponse,
} from "./training-records";

/**
 * Contract-valid example payloads for the training-records endpoints, for tests
 * in any package. `training-records.test.ts` parses every builder against its
 * response schema.
 */

export function buildTrainingRecordListItem(
  overrides: Partial<TrainingRecordListItem> = {},
): TrainingRecordListItem {
  return {
    id: 1,
    userId: "user-1",
    userName: "Técnica Alfa",
    competenceId: null,
    title: "Treinamento GUM",
    type: "internal",
    status: "planned",
    provider: null,
    startDate: "2026-05-20T00:00:00.000Z",
    endDate: null,
    hoursCompleted: null,
    score: null,
    passingScore: null,
    passed: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

export function buildTrainingRecordsListResponse(
  data: TrainingRecordListItem[] = [buildTrainingRecordListItem()],
): TrainingRecordsListResponse {
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
