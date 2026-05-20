import type {
  PortalDomainActionResponse,
  PortalDomainResponse,
  PortalDomainsApi,
} from "../types";
import { readApiError } from "../transport/response";

export function createPortalDomainsApi(rawCloudClient: any): PortalDomainsApi {
  return {
    async get() {
      const response = await rawCloudClient.api["portal-domains"].$get();

      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Falha ao carregar domínio do portal"),
        );
      }

      return response.json() as Promise<PortalDomainResponse>;
    },
    async create(input) {
      const response = await rawCloudClient.api["portal-domains"].$post({
        json: input,
      });

      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Falha ao salvar domínio"),
        );
      }

      return response.json() as Promise<PortalDomainActionResponse>;
    },
    async verify() {
      const response =
        await rawCloudClient.api["portal-domains"].verify.$post();

      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Falha ao verificar domínio"),
        );
      }

      return response.json() as Promise<PortalDomainActionResponse>;
    },
    async activate() {
      const response =
        await rawCloudClient.api["portal-domains"].activate.$post();

      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Falha ao ativar domínio"),
        );
      }

      return response.json() as Promise<PortalDomainActionResponse>;
    },
    async delete() {
      const response = await rawCloudClient.api["portal-domains"].$delete();

      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Falha ao remover domínio"),
        );
      }
    },
  };
}
