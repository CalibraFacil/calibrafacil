import type {
  PortalDomainActionResponse,
  PortalDomainResponse,
  PortalDomainsApi,
} from "../types";
import { readJsonResponse, readMutationResponse } from "../transport/response";

export function createPortalDomainsApi(rawCloudClient: any): PortalDomainsApi {
  return {
    async get() {
      return readJsonResponse<PortalDomainResponse>(
        await rawCloudClient.api["portal-domains"].$get(),
        "Falha ao carregar domínio do portal",
      );
    },
    async create(input) {
      return readJsonResponse<PortalDomainActionResponse>(
        await rawCloudClient.api["portal-domains"].$post({
          json: input,
        }),
        "Falha ao salvar domínio",
      );
    },
    async verify() {
      return readJsonResponse<PortalDomainActionResponse>(
        await rawCloudClient.api["portal-domains"].verify.$post(),
        "Falha ao verificar domínio",
      );
    },
    async activate() {
      return readJsonResponse<PortalDomainActionResponse>(
        await rawCloudClient.api["portal-domains"].activate.$post(),
        "Falha ao ativar domínio",
      );
    },
    async delete() {
      await readMutationResponse<unknown>(
        await rawCloudClient.api["portal-domains"].$delete(),
        "Falha ao remover domínio",
      );
    },
  };
}
