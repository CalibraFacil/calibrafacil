import type {
  ApiKeySecretResponse,
  ApiKeysApi,
  ApiKeysListResponse,
} from "../types";
import { readApiError } from "../transport/response";

export function createApiKeysApi(rawCloudClient: any): ApiKeysApi {
  return {
    async list() {
      const response = await rawCloudClient.api["api-keys"].$get();

      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Falha ao carregar API keys"),
        );
      }

      return response.json() as Promise<ApiKeysListResponse>;
    },
    async create(input) {
      const response = await rawCloudClient.api["api-keys"].$post({
        json: input,
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "Falha ao criar API key"));
      }

      return response.json() as Promise<ApiKeySecretResponse>;
    },
    async rotate(id) {
      const response = await rawCloudClient.api["api-keys"][":id"].rotate.$post(
        {
          param: { id },
        },
      );

      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Falha ao rotacionar API key"),
        );
      }

      return response.json() as Promise<ApiKeySecretResponse>;
    },
    async revoke(id) {
      const response = await rawCloudClient.api["api-keys"][":id"].revoke.$post(
        {
          param: { id },
        },
      );

      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Falha ao revogar API key"),
        );
      }

      return response.json() as Promise<{ success: boolean }>;
    },
  };
}
