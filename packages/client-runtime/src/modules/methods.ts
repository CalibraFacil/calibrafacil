import type {
  MethodAuditLogData,
  MethodDetailData,
  MethodsApi,
  MethodsListData,
  MethodsListInput,
  MethodWriteInput,
} from "../types";
import { readJsonResponse } from "../transport/response";

export function createMethodsApi(rawCloudClient: any): MethodsApi {
  return {
    async list(input: MethodsListInput = {}) {
      return readJsonResponse<MethodsListData>(
        await rawCloudClient.api.methods.$get({
          query: {
            page: String(input.page ?? 1),
            limit: String(input.limit ?? 20),
            status: input.status || undefined,
            assetTypeId: input.assetTypeId
              ? String(input.assetTypeId)
              : undefined,
            query: input.query || undefined,
            includeArchived: input.status === "ARCHIVED" ? "true" : undefined,
          },
        }),
        "Falha ao carregar métodos",
      );
    },
    async get(id: string | number) {
      return readJsonResponse<MethodDetailData>(
        await rawCloudClient.api.methods[":id"].$get({
          param: { id: String(id) },
        }),
        "Falha ao carregar método",
      );
    },
    async audit<TRecord = unknown>(id: string | number) {
      return readJsonResponse<MethodAuditLogData<TRecord>>(
        await rawCloudClient.api.methods[":id"].audit.$get({
          param: { id: String(id) },
        }),
        "Falha ao carregar histórico",
      );
    },
    async create(input: MethodWriteInput) {
      return readJsonResponse<MethodDetailData>(
        await rawCloudClient.api.methods.$post({ json: input }),
        "Erro ao criar método",
      );
    },
    async update(id: string | number, input: MethodWriteInput) {
      return readJsonResponse<MethodDetailData>(
        await rawCloudClient.api.methods[":id"].$put({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao atualizar método",
      );
    },
    async archive(id: string | number) {
      return readJsonResponse<unknown>(
        await rawCloudClient.api.methods[":id"].archive.$post({
          param: { id: String(id) },
        }),
        "Erro ao arquivar método",
      );
    },
    async createNewVersion(id: string | number) {
      return readJsonResponse<MethodDetailData>(
        await rawCloudClient.api.methods[":id"]["new-version"].$post({
          param: { id: String(id) },
        }),
        "Erro ao criar nova versão",
      );
    },
    async technicalReview(id: string | number) {
      return readJsonResponse<unknown>(
        await rawCloudClient.api.methods[":id"]["technical-review"].$post({
          param: { id: String(id) },
        }),
        "Erro ao revisar tecnicamente",
      );
    },
    async qualityApprove(id: string | number, input: MethodWriteInput = {}) {
      return readJsonResponse<unknown>(
        await rawCloudClient.api.methods[":id"]["quality-approve"].$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao aprovar qualidade",
      );
    },
    async returnToDraft(id: string | number, reason: string) {
      return readJsonResponse<unknown>(
        await rawCloudClient.api.methods[":id"]["return-to-draft"].$post({
          param: { id: String(id) },
          json: { reason },
        }),
        "Erro ao retornar para rascunho",
      );
    },
  };
}
