import type {
  CompetenceAssignTrainingInput,
  CompetenceCreateInput,
  CompetenceEvaluateInput,
  CompetenceListInput,
  CompetencesApi,
} from "../types";
import { readJsonResponse } from "../transport/response";

export function createCompetencesApi(rawCloudClient: any): CompetencesApi {
  return {
    async list<TResponse = unknown>(input: CompetenceListInput) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.competences.$get({
          query: {
            page: String(input.page),
            limit: String(input.limit),
            status: input.status || undefined,
            userId: input.userId || undefined,
            assetTypeId:
              input.assetTypeId === undefined
                ? undefined
                : String(input.assetTypeId),
          },
        }),
        "Falha ao carregar competências",
      );
    },
    async matrix<TResponse = unknown>() {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.competences.matrix.$get(),
        "Falha ao carregar matriz",
      );
    },
    async get<TResponse = unknown>(id: string | number) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.competences[":id"].$get({
          param: { id: String(id) },
        }),
        "Falha ao carregar competência",
      );
    },
    async auditLog<TResponse = unknown>(id: string | number) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.competences[":id"]["audit-log"].$get({
          param: { id: String(id) },
        }),
        "Falha ao carregar histórico",
      );
    },
    async create<TResponse = unknown>(input: CompetenceCreateInput) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.competences.$post({ json: input }),
        "Erro ao criar solicitação",
      );
    },
    async transition<TResponse = unknown>(
      id: string | number,
      action: "start-training" | "complete-training" | "suspend",
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.competences[":id"][action].$post({
          param: { id: String(id) },
        }),
        "Erro na operação",
      );
    },
    async evaluate<TResponse = unknown>(
      id: string | number,
      input: CompetenceEvaluateInput,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.competences[":id"].evaluate.$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro na avaliação",
      );
    },
    async renew<TResponse = unknown>(
      id: string | number,
      input: CompetenceEvaluateInput,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.competences[":id"].renew.$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro na renovação",
      );
    },
    async cancel<TResponse = unknown>(
      id: string | number,
      input: { notes?: string } = {},
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.competences[":id"].cancel.$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao cancelar competência",
      );
    },
    async delete<TResponse = unknown>(id: string | number) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.competences[":id"].$delete({
          param: { id: String(id) },
        }),
        "Erro ao excluir competência",
      );
    },
    async assignTraining<TResponse = unknown>(
      id: string | number,
      input: CompetenceAssignTrainingInput,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.competences[":id"]["assign-training"].$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao atribuir treinamento",
      );
    },
  };
}
