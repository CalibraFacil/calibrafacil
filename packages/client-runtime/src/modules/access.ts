import type {
  AccessApi,
  FinanceAccessResponse,
  PlanAccessResponse,
} from "../types";
import { readJsonResponse } from "../transport/response";

export function createAccessApi(rawCloudClient: any): AccessApi {
  return {
    async getPlanAccess() {
      return readJsonResponse<PlanAccessResponse>(
        await rawCloudClient.api.billing.access.$get(),
        "Erro ao carregar plano atual",
      );
    },
    async getFinanceAccess() {
      return readJsonResponse<FinanceAccessResponse>(
        await rawCloudClient.api.finance.access.$get(),
        "Erro ao carregar acesso financeiro",
      );
    },
  };
}
