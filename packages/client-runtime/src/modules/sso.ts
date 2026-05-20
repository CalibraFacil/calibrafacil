import type {
  CreateSsoProviderResponse,
  RequestSsoDomainVerificationResponse,
  SsoApi,
  SsoSettingsResponse,
  StartSsoResponse,
  VerifySsoDomainResponse,
} from "../types";
import { readApiError } from "../transport/response";

export function createSsoApi(rawCloudClient: any): SsoApi {
  return {
    async start(input) {
      const response = await rawCloudClient.api.sso.start.$post({
        json: input,
      });

      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Falha ao iniciar login via SSO"),
        );
      }

      return response.json() as Promise<StartSsoResponse>;
    },
    async getProviders() {
      const response = await rawCloudClient.api.sso.providers.$get();

      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Falha ao carregar configuração SSO"),
        );
      }

      return response.json() as Promise<SsoSettingsResponse>;
    },
    async createProvider(input) {
      const response = await rawCloudClient.api.sso.providers.$post({
        json: input,
      });

      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Falha ao registrar provedor SSO"),
        );
      }

      return response.json() as Promise<CreateSsoProviderResponse>;
    },
    async requestDomainVerification(providerId) {
      const response = await rawCloudClient.api.sso.providers[":providerId"][
        "request-domain-verification"
      ].$post({
        param: { providerId },
      });

      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Falha ao gerar token DNS"),
        );
      }

      return response.json() as Promise<RequestSsoDomainVerificationResponse>;
    },
    async verifyDomain(providerId) {
      const response = await rawCloudClient.api.sso.providers[":providerId"][
        "verify-domain"
      ].$post({
        param: { providerId },
      });

      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Falha ao verificar domínio"),
        );
      }

      return response.json() as Promise<VerifySsoDomainResponse>;
    },
    async deleteProvider(providerId) {
      const response = await rawCloudClient.api.sso.providers[
        ":providerId"
      ].$delete({
        param: { providerId },
      });

      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Falha ao remover provedor SSO"),
        );
      }
    },
  };
}
