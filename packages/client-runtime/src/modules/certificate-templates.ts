import type {
  CertificateTemplateCreateInput,
  CertificateTemplateUpdateInput,
  CertificateTemplateXlsxAssignmentInput,
  CertificateTemplatesApi,
} from "../types";
import type { CreateCloudApiClientOptions } from "../transport/cloud";
import { createCloudHeaders } from "../transport/cloud";
import { appendNamedBlob } from "../transport/form-data";
import { readJsonResponse } from "../transport/response";

export function createCertificateTemplatesApi(
  rawCloudClient: any,
  options: CreateCloudApiClientOptions,
): CertificateTemplatesApi {
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
    async list<TResponse = unknown>() {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api["certificate-templates"].$get(),
        "Falha ao carregar templates",
      );
    },
    async create<TResponse = unknown>(input: CertificateTemplateCreateInput) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api["certificate-templates"].$post({
          json: input,
        }),
        "Falha ao criar template",
      );
    },
    async update<TResponse = unknown>(
      id: string | number,
      input: CertificateTemplateUpdateInput,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api["certificate-templates"][":id"].$put({
          param: { id: String(id) },
          json: input,
        }),
        "Falha ao atualizar template",
      );
    },
    async duplicate<TResponse = unknown>(id: string | number) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api["certificate-templates"][
          ":id"
        ].duplicate.$post({
          param: { id: String(id) },
        }),
        "Falha ao duplicar template",
      );
    },
    async setDefault<TResponse = unknown>(id: string | number) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api["certificate-templates"][":id"][
          "set-default"
        ].$post({
          param: { id: String(id) },
        }),
        "Falha ao definir template padrão",
      );
    },
    async getXlsxVersion<TResponse = unknown>(
      templateId: string | number,
      versionId: string | number,
    ) {
      return fetchJson<TResponse>(
        `/api/certificate-templates/${templateId}/versions/${versionId}`,
        { method: "GET" },
        "Falha ao carregar XLSX atual",
      );
    },
    async uploadXlsx<TResponse = unknown>(
      templateId: string | number,
      file: Blob,
      input?: { fileName?: string },
    ) {
      const formData = new FormData();
      appendNamedBlob(formData, "xlsx", file, input?.fileName);

      return fetchJson<TResponse>(
        `/api/certificate-templates/${templateId}/versions/upload-xlsx`,
        { method: "POST", body: formData },
        "Falha ao enviar XLSX",
      );
    },
    async validateXlsx<TResponse = unknown>(
      templateId: string | number,
      versionId: string | number,
    ) {
      return fetchJson<TResponse>(
        `/api/certificate-templates/${templateId}/versions/${versionId}/validate`,
        { method: "POST" },
        "Falha ao validar XLSX",
      );
    },
    async updateXlsxBindings<TResponse = unknown>(
      templateId: string | number,
      versionId: string | number,
      input: { manifest: unknown },
    ) {
      return fetchJson<TResponse>(
        `/api/certificate-templates/${templateId}/versions/${versionId}/bindings`,
        { method: "PATCH", body: JSON.stringify(input) },
        "Falha ao salvar vínculos XLSX",
      );
    },
    async createXlsxPreview<TResponse = unknown>(
      templateId: string | number,
      versionId: string | number,
      input: { sampleData: unknown },
    ) {
      return fetchJson<TResponse>(
        `/api/certificate-templates/${templateId}/versions/${versionId}/preview`,
        { method: "POST", body: JSON.stringify(input) },
        "Falha ao solicitar prévia XLSX",
      );
    },
    async getXlsxPreview<TResponse = unknown>(
      templateId: string | number,
      versionId: string | number,
      previewId: string | number,
    ) {
      return fetchJson<TResponse>(
        `/api/certificate-templates/${templateId}/versions/${versionId}/previews/${previewId}`,
        { method: "GET" },
        "Falha ao carregar prévia",
      );
    },
    async publishXlsx<TResponse = unknown>(
      templateId: string | number,
      versionId: string | number,
    ) {
      return fetchJson<TResponse>(
        `/api/certificate-templates/${templateId}/versions/${versionId}/publish`,
        { method: "POST" },
        "Falha ao publicar XLSX",
      );
    },
    async createXlsxAssignment<TResponse = unknown>(
      templateId: string | number,
      versionId: string | number,
      input: CertificateTemplateXlsxAssignmentInput,
    ) {
      return fetchJson<TResponse>(
        `/api/certificate-templates/${templateId}/versions/${versionId}/assignments`,
        { method: "POST", body: JSON.stringify(input) },
        "Falha ao atribuir template",
      );
    },
    async migrateToWysiwyg<TResponse = unknown>(templateId: string | number) {
      return fetchJson<TResponse>(
        `/api/certificate-templates/${templateId}/migrate-to-wysiwyg`,
        { method: "POST" },
        "Falha ao migrar template para o editor visual",
      );
    },
    // ---- wysiwyg engine (epic wysiwyg, spec 02 §6.1) ----
    async getWysiwygDocument<TResponse = unknown>(
      templateId: string | number,
      versionId: string | number,
    ) {
      return fetchJson<TResponse>(
        `/api/certificate-templates/${templateId}/versions/${versionId}/document`,
        { method: "GET" },
        "Falha ao carregar o documento do modelo",
      );
    },
    async getPlaceholderCatalog<TResponse = unknown>() {
      return fetchJson<TResponse>(
        "/api/certificate-templates/placeholder-catalog",
        { method: "GET" },
        "Falha ao carregar o catálogo de campos",
      );
    },
    async saveWysiwygDocument<TResponse = unknown>(
      templateId: string | number,
      versionId: string | number,
      input: {
        documentJson: Record<string, unknown>;
        expectedDocumentSha256?: string;
      },
    ) {
      return fetchJson<TResponse>(
        `/api/certificate-templates/${templateId}/versions/${versionId}/document`,
        { method: "PUT", body: JSON.stringify(input) },
        "Falha ao salvar o documento do modelo",
      );
    },
    async validateWysiwygDocument<TResponse = unknown>(
      templateId: string | number,
      versionId: string | number,
    ) {
      return fetchJson<TResponse>(
        `/api/certificate-templates/${templateId}/versions/${versionId}/validate-document`,
        { method: "POST" },
        "Falha ao validar o documento do modelo",
      );
    },
    async createWysiwygVersion<TResponse = unknown>(
      templateId: string | number,
    ) {
      return fetchJson<TResponse>(
        `/api/certificate-templates/${templateId}/versions/wysiwyg`,
        { method: "POST" },
        "Falha ao criar nova versão do modelo",
      );
    },
  };
}
