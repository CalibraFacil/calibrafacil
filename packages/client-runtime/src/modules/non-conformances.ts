import type {
  CreateNonConformanceInput,
  NonConformanceDispositionInput,
  NonConformanceEscalateInput,
  NonConformanceListInput,
  NonConformanceResolveInput,
  NonConformancesApi,
} from "../types";
import { readJsonResponse } from "../transport/response";

export function createNonConformancesApi(
  rawCloudClient: any,
): NonConformancesApi {
  return {
    async list<TResponse = unknown>(input: NonConformanceListInput) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.nc.$get({
          query: {
            page: String(input.page),
            limit: String(input.limit),
            query: input.query || undefined,
            status: input.status || undefined,
            type: input.type || undefined,
            jobId: input.jobId === undefined ? undefined : String(input.jobId),
            dateFrom: input.dateFrom || undefined,
            dateTo: input.dateTo || undefined,
          },
        }),
        "Falha ao carregar não conformidades",
      );
    },
    async summary<TResponse = unknown>() {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.nc.summary.$get(),
        "Falha ao carregar resumo",
      );
    },
    async get<TResponse = unknown>(id: string | number) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.nc[":id"].$get({
          param: { id: String(id) },
        }),
        "Falha ao carregar NC",
      );
    },
    async auditLog<TResponse = unknown>(id: string | number) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.nc[":id"]["audit-log"].$get({
          param: { id: String(id) },
        }),
        "Falha ao carregar histórico",
      );
    },
    async create<TResponse = unknown>(input: CreateNonConformanceInput) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.nc.$post({ json: input }),
        "Erro ao registrar NC",
      );
    },
    async setDisposition<TResponse = unknown>(
      id: string | number,
      input: NonConformanceDispositionInput,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.nc[":id"].disposition.$put({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao definir disposição",
      );
    },
    async resolve<TResponse = unknown>(
      id: string | number,
      input: NonConformanceResolveInput,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.nc[":id"].resolve.$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao resolver",
      );
    },
    async escalateToCapa<TResponse = unknown>(
      id: string | number,
      input: NonConformanceEscalateInput,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.nc[":id"]["escalate-to-capa"].$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao escalar para CAPA",
      );
    },
  };
}
