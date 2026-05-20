import type {
  AccessApi,
  FinanceAccessResponse,
  PlanAccessResponse,
} from "../types";

export function createAccessApi(rawCloudClient: any): AccessApi {
  return {
    async getPlanAccess() {
      const response = await rawCloudClient.api.billing.access.$get();

      if (!response.ok) {
        throw new Error("Erro ao carregar plano atual");
      }

      return response.json() as Promise<PlanAccessResponse>;
    },
    async getFinanceAccess() {
      const response = await rawCloudClient.api.finance.access.$get();

      if (!response.ok) {
        throw new Error("Erro ao carregar acesso financeiro");
      }

      return response.json() as Promise<FinanceAccessResponse>;
    },
  };
}
