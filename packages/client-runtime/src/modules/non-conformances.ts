import type {
  CreateNonConformanceInput,
  CreateNonConformanceResult,
  NonConformanceDispositionInput,
  NonConformanceEscalateInput,
  NonConformanceListInput,
  NonConformanceResolveInput,
  NonConformancesApi,
  RegisterOotAcknowledgementInput,
  SaveOotImpactAssessmentInput,
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
    async create(input: CreateNonConformanceInput) {
      return readJsonResponse<CreateNonConformanceResult>(
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
    async getOotNotification<TResponse = unknown>(id: string | number) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.nc[":id"]["oot-notification"].$get({
          param: { id: String(id) },
        }),
        "Falha ao carregar notificação 7.10",
      );
    },
    async registerOotAcknowledgement<TResponse = unknown>(
      id: string | number,
      input: RegisterOotAcknowledgementInput,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.nc[":id"]["oot-ack"].$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao registrar confirmação de recebimento",
      );
    },
    async getImpactAssessment<TResponse = unknown>(id: string | number) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.nc[":id"]["oot-impact-assessment"].$get({
          param: { id: String(id) },
        }),
        "Falha ao carregar avaliação de impacto",
      );
    },
    async saveImpactAssessment<TResponse = unknown>(
      id: string | number,
      input: SaveOotImpactAssessmentInput,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.nc[":id"]["oot-impact-assessment"].$put({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao salvar avaliação de impacto",
      );
    },
    async signImpactAssessment<TResponse = unknown>(id: string | number) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.nc[":id"]["oot-impact-assessment"].sign.$post({
          param: { id: String(id) },
        }),
        "Erro ao assinar avaliação de impacto",
      );
    },
  };
}
