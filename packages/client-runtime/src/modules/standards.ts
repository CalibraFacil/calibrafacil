import type {
  MassCompositionProfileDto,
  MassCompositionProfilesData,
  MassCompositionProfileWriteInput,
  StandardAuditLogData,
  StandardCertificateDocumentDownloadResponse,
  StandardCertificateDocumentUploadResponse,
  StandardData,
  StandardsApi,
  StandardsListData,
  StandardsListInput,
  StandardWriteInput,
} from "../types";
import type { CreateCloudApiClientOptions } from "../transport/cloud";
import { createCloudHeaders } from "../transport/cloud";
import { appendNamedBlob } from "../transport/form-data";
import { readJsonResponse } from "../transport/response";

export function createStandardsApi(
  rawCloudClient: any,
  options: CreateCloudApiClientOptions,
): StandardsApi {
  const fetchJson = async <TResponse>(
    path: string,
    init: RequestInit,
    fallback: string,
  ) => {
    const headers = createCloudHeaders(options.activeUnitProvider);
    if (init.body && !(init.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }

    return readJsonResponse<TResponse>(
      await (options.fetch ?? fetch)(new URL(path, options.baseUrl), {
        ...init,
        credentials: "include",
        headers,
      }),
      fallback,
    );
  };

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
    async listCompositionProfiles() {
      return readJsonResponse<MassCompositionProfilesData>(
        await rawCloudClient.api.standards["composition-profiles"].$get(),
        "Falha ao carregar perfis de composição",
      );
    },
    async createCompositionProfile(input: MassCompositionProfileWriteInput) {
      return readJsonResponse<MassCompositionProfileDto>(
        await rawCloudClient.api.standards["composition-profiles"].$post({
          json: input,
        }),
        "Erro ao criar perfil de composição",
      );
    },
    async updateCompositionProfile(
      id: number,
      input: Partial<MassCompositionProfileWriteInput>,
    ) {
      return readJsonResponse<MassCompositionProfileDto>(
        await rawCloudClient.api.standards["composition-profiles"][":id"].$put({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao atualizar perfil de composição",
      );
    },
    async deleteCompositionProfile(id: number) {
      return readJsonResponse<{ success: boolean; id: number }>(
        await rawCloudClient.api.standards["composition-profiles"][
          ":id"
        ].$delete({
          param: { id: String(id) },
        }),
        "Erro ao remover perfil de composição",
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
    async getImpactedCertificates<TResponse = unknown>(
      id: string | number,
      input: { from?: string; to?: string } = {},
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.standards[":id"]["impacted-certificates"].$get(
          {
            param: { id: String(id) },
            query: { from: input.from, to: input.to },
          },
        ),
        "Falha ao carregar certificados afetados",
      );
    },
    async getRecall<TResponse = unknown>(id: string | number) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.standards[":id"].recall.$get({
          param: { id: String(id) },
        }),
        "Falha ao carregar recall",
      );
    },
    async sendRecall<TResponse = unknown>(
      id: string | number,
      input: { jobIds: number[]; from?: string; to?: string },
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.standards[":id"].recall.send.$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao enviar recall",
      );
    },
    async uploadCertificateDocument(id, file, input) {
      const formData = new FormData();
      appendNamedBlob(formData, "certificate", file, input?.fileName);

      return fetchJson<StandardCertificateDocumentUploadResponse>(
        `/api/standards/${encodeURIComponent(String(id))}/certificate-document`,
        { method: "POST", body: formData },
        "Erro ao enviar certificado do padrão",
      );
    },
    async getCertificateDocumentDownloadUrl(id) {
      return fetchJson<StandardCertificateDocumentDownloadResponse>(
        `/api/standards/${encodeURIComponent(String(id))}/certificate-document/download`,
        { method: "GET" },
        "Falha ao gerar link do certificado do padrão",
      );
    },
  };
}
