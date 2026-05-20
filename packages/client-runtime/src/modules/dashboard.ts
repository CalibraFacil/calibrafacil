import type { DashboardApi, DashboardStats } from "../types";

export function createDashboardApi(rawCloudClient: any): DashboardApi {
  return {
    async getStats<TStats = DashboardStats>() {
      const response = await rawCloudClient.api.dashboard.stats.$get();

      if (!response.ok) {
        throw new Error("Falha ao carregar estatísticas");
      }

      return response.json() as Promise<TStats>;
    },
  };
}
