import type { AccessApi, FinanceAccessResponse } from "../types";
import { readJsonResponse } from "../transport/response";

export function createAccessApi(rawCloudClient: any): AccessApi {
  return {
    async getFinanceAccess() {
      return readJsonResponse<FinanceAccessResponse>(
        await rawCloudClient.api.finance.access.$get(),
        "Erro ao carregar acesso financeiro",
      );
    },
  };
}
