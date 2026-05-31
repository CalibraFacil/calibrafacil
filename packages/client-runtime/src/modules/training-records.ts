import type {
  TrainingRecordCreateInput,
  TrainingRecordsApi,
  TrainingRecordsListInput,
} from "../types";
import { readJsonResponse } from "../transport/response";

export function createTrainingRecordsApi(
  rawCloudClient: any,
): TrainingRecordsApi {
  return {
    async list<TResponse = unknown>(input: TrainingRecordsListInput) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api["training-records"].$get({
          query: {
            page: String(input.page),
            limit: String(input.limit),
            userId: input.userId || undefined,
            competenceId:
              input.competenceId === undefined
                ? undefined
                : String(input.competenceId),
            status: input.status || undefined,
            type: input.type || undefined,
          },
        }),
        "Falha ao carregar treinamentos",
      );
    },
    async create<TResponse = unknown>(input: TrainingRecordCreateInput) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api["training-records"].$post({ json: input }),
        "Erro ao criar registro de treinamento",
      );
    },
  };
}
