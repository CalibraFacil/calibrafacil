import type {
  BillingApi,
  BillingPaymentsResponse,
  BillingSubscriptionResponse,
} from "../types";
import { readJsonResponse } from "../transport/response";

export function createBillingApi(rawCloudClient: any): BillingApi {
  return {
    async getSubscription() {
      return readJsonResponse<BillingSubscriptionResponse>(
        await rawCloudClient.api.billing.subscription.$get(),
        "Erro ao carregar assinatura",
      );
    },
    async listPayments(input = {}) {
      return readJsonResponse<BillingPaymentsResponse>(
        await rawCloudClient.api.billing.payments.$get({
          query: {
            limit: input.limit === undefined ? undefined : String(input.limit),
            offset:
              input.offset === undefined ? undefined : String(input.offset),
          },
        }),
        "Erro ao carregar pagamentos",
      );
    },
  };
}
