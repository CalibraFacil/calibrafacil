import type {
  ApiKeySecretResponse,
  ApiKeysApi,
  ApiKeysListResponse,
} from "../types";
import { readJsonResponse } from "../transport/response";

export function createApiKeysApi(rawCloudClient: any): ApiKeysApi {
  return {
    async list() {
      return readJsonResponse<ApiKeysListResponse>(
        await rawCloudClient.api["api-keys"].$get(),
        "Falha ao carregar API keys",
      );
    },
    async create(input) {
      return readJsonResponse<ApiKeySecretResponse>(
        await rawCloudClient.api["api-keys"].$post({
          json: input,
        }),
        "Falha ao criar API key",
      );
    },
    async rotate(id) {
      return readJsonResponse<ApiKeySecretResponse>(
        await rawCloudClient.api["api-keys"][":id"].rotate.$post({
          param: { id },
        }),
        "Falha ao rotacionar API key",
      );
    },
    async revoke(id) {
      return readJsonResponse<{ success: boolean }>(
        await rawCloudClient.api["api-keys"][":id"].revoke.$post({
          param: { id },
        }),
        "Falha ao revogar API key",
      );
    },
  };
}
