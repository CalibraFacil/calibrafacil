import type {
  CreateSsoProviderResponse,
  RequestSsoDomainVerificationResponse,
  SsoApi,
  SsoSettingsResponse,
  StartSsoResponse,
  VerifySsoDomainResponse,
} from "../types";
import { readJsonResponse, readMutationResponse } from "../transport/response";

export function createSsoApi(rawCloudClient: any): SsoApi {
  return {
    async start(input) {
      return readJsonResponse<StartSsoResponse>(
        await rawCloudClient.api.sso.start.$post({
          json: input,
        }),
        "Falha ao iniciar login via SSO",
      );
    },
    async getProviders() {
      return readJsonResponse<SsoSettingsResponse>(
        await rawCloudClient.api.sso.providers.$get(),
        "Falha ao carregar configuração SSO",
      );
    },
    async createProvider(input) {
      return readJsonResponse<CreateSsoProviderResponse>(
        await rawCloudClient.api.sso.providers.$post({
          json: input,
        }),
        "Falha ao registrar provedor SSO",
      );
    },
    async requestDomainVerification(providerId) {
      return readJsonResponse<RequestSsoDomainVerificationResponse>(
        await rawCloudClient.api.sso.providers[":providerId"][
          "request-domain-verification"
        ].$post({
          param: { providerId },
        }),
        "Falha ao gerar token DNS",
      );
    },
    async verifyDomain(providerId) {
      return readJsonResponse<VerifySsoDomainResponse>(
        await rawCloudClient.api.sso.providers[":providerId"][
          "verify-domain"
        ].$post({
          param: { providerId },
        }),
        "Falha ao verificar domínio",
      );
    },
    async deleteProvider(providerId) {
      await readMutationResponse<unknown>(
        await rawCloudClient.api.sso.providers[":providerId"].$delete({
          param: { providerId },
        }),
        "Falha ao remover provedor SSO",
      );
    },
  };
}
