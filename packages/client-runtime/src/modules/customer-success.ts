import type { CustomerSuccessApi, CustomerSuccessRequestInput } from "../types";
import { readJsonResponse } from "../transport/response";

export function createCustomerSuccessApi(
  rawCloudClient: any,
): CustomerSuccessApi {
  return {
    async getProfile<TResponse = unknown>() {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api["customer-success"].profile.$get(),
        "Falha ao carregar Customer Success",
      );
    },
    async listRequests<TResponse = unknown>() {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api["customer-success"].requests.$get(),
        "Falha ao carregar solicitações",
      );
    },
    async createRequest<TResponse = unknown>(
      input: CustomerSuccessRequestInput,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api["customer-success"].requests.$post({
          json: input,
        }),
        "Falha ao abrir solicitação",
      );
    },
  };
}
