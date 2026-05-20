import type {
  BillingApi,
  BillingPaymentsResponse,
  BillingSubscriptionResponse,
} from "../types";
import { readApiError } from "../transport/response";

export function createBillingApi(rawCloudClient: any): BillingApi {
  return {
    async getSubscription() {
      const response = await rawCloudClient.api.billing.subscription.$get();

      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Erro ao carregar assinatura"),
        );
      }

      return response.json() as Promise<BillingSubscriptionResponse>;
    },
    async listPayments(input = {}) {
      const response = await rawCloudClient.api.billing.payments.$get({
        query: {
          limit: input.limit === undefined ? undefined : String(input.limit),
          offset: input.offset === undefined ? undefined : String(input.offset),
        },
      });

      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Erro ao carregar pagamentos"),
        );
      }

      return response.json() as Promise<BillingPaymentsResponse>;
    },
  };
}
