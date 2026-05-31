import type { ReportsApi, ReportsQueryInput } from "../types";
import { readJsonResponse } from "../transport/response";

function reportQuery(input: ReportsQueryInput | undefined) {
  return {
    period: input?.period || undefined,
    unitIds: input?.unitIds || undefined,
  };
}

export function createReportsApi(rawCloudClient: any): ReportsApi {
  return {
    async getExecutiveOverview<TResponse = unknown>(input?: ReportsQueryInput) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.reports.consolidated[
          "executive-overview"
        ].$get({
          query: reportQuery(input),
        }),
        "Falha ao carregar visão executiva",
      );
    },
    async getComparison<TResponse = unknown>(input?: ReportsQueryInput) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.reports.consolidated.comparison.$get({
          query: reportQuery(input),
        }),
        "Falha ao carregar comparativo consolidado",
      );
    },
    async getTrend<TResponse = unknown>(input?: ReportsQueryInput) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.reports.consolidated.trend.$get({
          query: reportQuery(input),
        }),
        "Falha ao carregar tendência consolidada",
      );
    },
  };
}
