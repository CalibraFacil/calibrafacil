import type { EmailDomainResponse, EmailDomainsApi } from "../types";
import { readJsonResponse, readMutationResponse } from "../transport/response";

export function createEmailDomainsApi(rawCloudClient: any): EmailDomainsApi {
  return {
    async get() {
      return readJsonResponse<EmailDomainResponse>(
        await rawCloudClient.api["email-domains"].$get(),
        "Falha ao carregar domínio de e-mail",
      );
    },
    async create(input) {
      return readJsonResponse<EmailDomainResponse>(
        await rawCloudClient.api["email-domains"].$post({
          json: input,
        }),
        "Falha ao salvar domínio de e-mail",
      );
    },
    async verify() {
      return readJsonResponse<EmailDomainResponse>(
        await rawCloudClient.api["email-domains"].verify.$post(),
        "Falha ao verificar domínio de e-mail",
      );
    },
    async activate() {
      return readJsonResponse<EmailDomainResponse>(
        await rawCloudClient.api["email-domains"].activate.$post(),
        "Falha ao ativar domínio de e-mail",
      );
    },
    async delete() {
      await readMutationResponse<unknown>(
        await rawCloudClient.api["email-domains"].$delete(),
        "Falha ao remover domínio de e-mail",
      );
    },
  };
}
