import type {
  VisitAssignInput,
  VisitCancelInput,
  VisitConfirmInput,
  VisitRescheduleInput,
  VisitsApi,
  VisitsListInput,
} from "../types";
import { readJsonResponse } from "../transport/response";

export function createVisitsApi(rawCloudClient: any): VisitsApi {
  return {
    async list<TResponse = unknown>(input: VisitsListInput = {}) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.visits.$get({
          query: {
            page: input.page ? String(input.page) : undefined,
            limit: input.limit ? String(input.limit) : undefined,
            status: input.status || undefined,
            technicianId: input.technicianId || undefined,
            dateFrom: input.dateFrom || undefined,
            dateTo: input.dateTo || undefined,
            mine: input.mine ? "true" : undefined,
          },
        }),
        "Falha ao carregar visitas",
      );
    },
    async get<TResponse = unknown>(id: string | number) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.visits[":id"].$get({
          param: { id: String(id) },
        }),
        "Falha ao carregar visita",
      );
    },
    async assign<TResponse = unknown>(
      id: string | number,
      input: VisitAssignInput,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.visits[":id"].assign.$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao atribuir técnico",
      );
    },
    async confirm<TResponse = unknown>(
      id: string | number,
      input: VisitConfirmInput = {},
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.visits[":id"].confirm.$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao confirmar visita",
      );
    },
    async reschedule<TResponse = unknown>(
      id: string | number,
      input: VisitRescheduleInput,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.visits[":id"].$patch({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao reagendar visita",
      );
    },
    async cancel<TResponse = unknown>(
      id: string | number,
      input: VisitCancelInput = {},
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.visits[":id"].cancel.$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao cancelar visita",
      );
    },
  };
}
