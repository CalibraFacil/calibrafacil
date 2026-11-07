import type {
  SpcApi,
  SpcChartCreateInput,
  SpcChartListInput,
  SpcChartUpdateInput,
  SpcEscalateInput,
  SpcReadingCreateInput,
  SpcReadingListInput,
} from "../types";
import { readJsonResponse } from "../transport/response";

export function createSpcApi(rawCloudClient: any): SpcApi {
  return {
    async listCharts<TResponse = unknown>(input: SpcChartListInput = {}) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.spc.charts.$get({
          query: {
            standardId:
              input.standardId === undefined
                ? undefined
                : String(input.standardId),
            status: input.status || undefined,
            page: input.page === undefined ? undefined : String(input.page),
            limit: input.limit === undefined ? undefined : String(input.limit),
          },
        }),
        "Falha ao carregar cartas de controle",
      );
    },
    async getChart<TResponse = unknown>(id: string | number) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.spc.charts[":id"].$get({
          param: { id: String(id) },
        }),
        "Carta de controle não encontrada",
      );
    },
    async createChart<TResponse = unknown>(input: SpcChartCreateInput) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.spc.charts.$post({ json: input }),
        "Erro ao criar carta de controle",
      );
    },
    async updateChart<TResponse = unknown>(
      id: string | number,
      input: SpcChartUpdateInput,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.spc.charts[":id"].$put({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao atualizar carta de controle",
      );
    },
    async removeChart<TResponse = unknown>(id: string | number) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.spc.charts[":id"].$delete({
          param: { id: String(id) },
        }),
        "Erro ao remover carta de controle",
      );
    },
    async recalculateChart<TResponse = unknown>(id: string | number) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.spc.charts[":id"].recalculate.$post({
          param: { id: String(id) },
        }),
        "Erro ao recalcular carta",
      );
    },
    async escalateChart<TResponse = unknown>(
      id: string | number,
      input: SpcEscalateInput = {},
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.spc.charts[":id"].escalate.$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao escalar sinal",
      );
    },
    async listReadings<TResponse = unknown>(input: SpcReadingListInput) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.spc.readings.$get({
          query: {
            standardId: String(input.standardId),
            parameter: input.parameter || undefined,
            limit: input.limit === undefined ? undefined : String(input.limit),
          },
        }),
        "Falha ao carregar leituras",
      );
    },
    async createReading<TResponse = unknown>(input: SpcReadingCreateInput) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.spc.readings.$post({ json: input }),
        "Erro ao registrar leitura",
      );
    },
    async removeReading<TResponse = unknown>(id: string | number) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.spc.readings[":id"].$delete({
          param: { id: String(id) },
        }),
        "Erro ao remover leitura",
      );
    },
  };
}
