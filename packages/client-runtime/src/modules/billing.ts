import type {
  BillingApi,
  BillingCancelSubscriptionResponse,
  BillingPaymentsResponse,
  BillingSubscriptionResponse,
  SelfServeCheckoutResponse,
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
    async startSelfServeCheckout(input) {
      return readJsonResponse<SelfServeCheckoutResponse>(
        await rawCloudClient.api.billing["self-serve-checkout"].$post({
          json: {
            planId: input.planId,
            billingCycle: input.billingCycle,
          },
          query: input.paymentMethod
            ? { pagamento: input.paymentMethod }
            : undefined,
        }),
        "Erro ao iniciar a contratação",
      );
    },
    async cancelSubscription() {
      return readJsonResponse<BillingCancelSubscriptionResponse>(
        await rawCloudClient.api.billing.subscription.$delete(),
        "Erro ao cancelar a assinatura",
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
