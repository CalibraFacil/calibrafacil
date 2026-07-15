import type {
  EmailDomainResponse,
  EmailDomainValidateKeyResponse,
  EmailDomainsApi,
} from "../types";
import { readJsonResponse, readMutationResponse } from "../transport/response";

export function createEmailDomainsApi(rawCloudClient: any): EmailDomainsApi {
  return {
    async get() {
      return readJsonResponse<EmailDomainResponse>(
        await rawCloudClient.api["email-domains"].$get(),
        "Falha ao carregar domínio de e-mail",
      );
    },
    async validateKey(input) {
      return readJsonResponse<EmailDomainValidateKeyResponse>(
        await rawCloudClient.api["email-domains"]["validate-key"].$post({
          json: input,
        }),
        "Falha ao validar a chave do Resend",
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
    async rotateKey(input) {
      return readJsonResponse<EmailDomainResponse>(
        await rawCloudClient.api["email-domains"].key.$post({
          json: input,
        }),
        "Falha ao atualizar a chave do Resend",
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
