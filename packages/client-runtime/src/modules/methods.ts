import type {
  MethodAuditLogData,
  MethodCompileDraftInput,
  MethodDetailData,
  MethodsApi,
  MethodsListData,
  MethodsListInput,
  MethodPreviewDraftInput,
  MethodPublishDraftInput,
  MethodRequestApprovalInput,
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
    async compileDraft<TResponse = unknown>(input: MethodCompileDraftInput) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.methods.compile.$post({ json: input }),
        "Erro ao compilar rascunho do método",
        { allowDiagnosticsResponse: true },
      );
    },
    async previewDraft<TResponse = unknown>(input: MethodPreviewDraftInput) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.methods.preview.$post({ json: input }),
        "Erro ao executar preview do método",
        { allowDiagnosticsResponse: true },
      );
    },
    async publishDraft<TResponse = unknown>(
      id: string | number,
      input: MethodPublishDraftInput,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.methods[":id"].publish.$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao publicar método",
      );
    },
    async requestApproval<TResponse = unknown>(
      id: string | number,
      input: MethodRequestApprovalInput,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.methods[":id"]["request-approval"].$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao solicitar aprovação",
      );
    },
  };
}
