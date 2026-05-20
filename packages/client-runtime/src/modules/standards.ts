import type {
  StandardAuditLogData,
  StandardData,
  StandardsApi,
  StandardsListData,
  StandardsListInput,
  StandardWriteInput,
} from "../types";
import { readJsonResponse } from "../transport/response";

export function createStandardsApi(rawCloudClient: any): StandardsApi {
  return {
    async list(input: StandardsListInput = {}) {
      return readJsonResponse<StandardsListData>(
        await rawCloudClient.api.standards.$get({
          query: {
            page: String(input.page ?? 1),
            limit: String(input.limit ?? 20),
            query: input.query || undefined,
            status: input.status || undefined,
          },
        }),
        "Falha ao carregar padrões",
      );
    },
    async get(id: string | number) {
      return readJsonResponse<StandardData>(
        await rawCloudClient.api.standards[":id"].$get({
          param: { id: String(id) },
        }),
        "Falha ao carregar padrão",
      );
    },
    async auditLog<TRecord = unknown>(id: string | number) {
      return readJsonResponse<StandardAuditLogData<TRecord>>(
        await rawCloudClient.api.standards[":id"]["audit-log"].$get({
          param: { id: String(id) },
        }),
        "Falha ao carregar histórico",
      );
    },
    async create(input: StandardWriteInput) {
      return readJsonResponse<{ id: number }>(
        await rawCloudClient.api.standards.$post({ json: input }),
        "Erro ao criar padrão",
      );
    },
    async update(id: string | number, input: StandardWriteInput) {
      return readJsonResponse<StandardData>(
        await rawCloudClient.api.standards[":id"].$put({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao atualizar padrão",
      );
    },
    async delete(id: string | number) {
      return readJsonResponse<unknown>(
        await rawCloudClient.api.standards[":id"].$delete({
          param: { id: String(id) },
        }),
        "Erro ao remover padrão",
      );
    },
    async renew(id: string | number, input: StandardWriteInput) {
      return readJsonResponse<unknown>(
        await rawCloudClient.api.standards[":id"].renew.$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao renovar certificado",
      );
    },
  };
}
