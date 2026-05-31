import type {
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
