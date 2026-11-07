import type {
  VisitAcceptRescheduleRequestInput,
  VisitAddJobInput,
  VisitAssignInput,
  VisitCancelInput,
  VisitConfirmInput,
  VisitDeclineRescheduleRequestInput,
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
            rescheduleRequested: input.rescheduleRequested ? "true" : undefined,
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
    async complete<TResponse = unknown>(id: string | number) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.visits[":id"].complete.$post({
          param: { id: String(id) },
        }),
        "Erro ao concluir visita",
      );
    },
    async addJob<TResponse = unknown>(
      id: string | number,
      input: VisitAddJobInput,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.visits[":id"].jobs.$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao adicionar instrumento a visita",
      );
    },
    async removeJob<TResponse = unknown>(
      id: string | number,
      jobId: string | number,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.visits[":id"].jobs[":jobId"].$delete({
          param: { id: String(id), jobId: String(jobId) },
        }),
        "Erro ao remover instrumento da visita",
      );
    },
    async acceptRescheduleRequest<TResponse = unknown>(
      id: string | number,
      requestId: string | number,
      input: VisitAcceptRescheduleRequestInput,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.visits[":id"]["reschedule-requests"][
          ":requestId"
        ].accept.$post({
          param: { id: String(id), requestId: String(requestId) },
          json: input,
        }),
        "Erro ao aceitar o reagendamento",
      );
    },
    async declineRescheduleRequest<TResponse = unknown>(
      id: string | number,
      requestId: string | number,
      input: VisitDeclineRescheduleRequestInput = {},
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.visits[":id"]["reschedule-requests"][
          ":requestId"
        ].decline.$post({
          param: { id: String(id), requestId: String(requestId) },
          json: input,
        }),
        "Erro ao recusar o reagendamento",
      );
    },
  };
}
