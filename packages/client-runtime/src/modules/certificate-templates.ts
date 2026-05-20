import type {
  CertificateTemplateCreateInput,
  CertificateTemplateUpdateInput,
  CertificateTemplatesApi,
} from "../types";
import { readJsonResponse } from "../transport/response";

export function createCertificateTemplatesApi(
  rawCloudClient: any,
): CertificateTemplatesApi {
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
  };
}
