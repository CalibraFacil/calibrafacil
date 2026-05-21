import type { DashboardApi, DashboardStats } from "../types";
import { readJsonResponse } from "../transport/response";

export function createDashboardApi(rawCloudClient: any): DashboardApi {
  return {
    async getStats<TStats = DashboardStats>() {
      return readJsonResponse<TStats>(
        await rawCloudClient.api.dashboard.stats.$get(),
        "Falha ao carregar estatísticas",
      );
    },
  };
}
