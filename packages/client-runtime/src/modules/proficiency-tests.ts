import type {
  ProficiencyTestCreateInput,
  ProficiencyTestListInput,
  ProficiencyTestRecordResultsInput,
  ProficiencyTestUpdateInput,
  ProficiencyTestsApi,
  PtPlanItemCreateInput,
  PtPlanItemUpdateInput,
  SpcApi,
  SpcChartCreateInput,
  SpcChartListInput,
  SpcChartUpdateInput,
  SpcEscalateInput,
  SpcReadingCreateInput,
  SpcReadingListInput,
} from "../types";
import { readJsonResponse } from "../transport/response";

export function createProficiencyTestsApi(
  rawCloudClient: any,
): ProficiencyTestsApi {
  return {
    async list<TResponse = unknown>(input: ProficiencyTestListInput) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api["proficiency-tests"].$get({
          query: {
            page: String(input.page),
            limit: String(input.limit),
            query: input.query || undefined,
            status: input.status || undefined,
            activityType: input.activityType || undefined,
            scopePart: input.scopePart || undefined,
          },
        }),
        "Falha ao carregar ensaios de proficiência",
      );
    },
    async summary<TResponse = unknown>() {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api["proficiency-tests"].summary.$get(),
        "Falha ao carregar resumo",
      );
    },
    async get<TResponse = unknown>(id: string | number) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api["proficiency-tests"][":id"].$get({
          param: { id: String(id) },
        }),
        "Ensaio de proficiência não encontrado",
      );
    },
    async auditLog<TResponse = unknown>(id: string | number) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api["proficiency-tests"][":id"]["audit-log"].$get({
          param: { id: String(id) },
        }),
        "Falha ao carregar histórico",
      );
    },
    async create<TResponse = unknown>(input: ProficiencyTestCreateInput) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api["proficiency-tests"].$post({ json: input }),
        "Erro ao registrar ensaio de proficiência",
      );
    },
    async update<TResponse = unknown>(
      id: string | number,
      input: ProficiencyTestUpdateInput,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api["proficiency-tests"][":id"].$put({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao atualizar ensaio de proficiência",
      );
    },
    async recordResults<TResponse = unknown>(
      id: string | number,
      input: ProficiencyTestRecordResultsInput,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api["proficiency-tests"][":id"].results.$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao registrar resultados",
      );
    },
    async remove<TResponse = unknown>(id: string | number) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api["proficiency-tests"][":id"].$delete({
          param: { id: String(id) },
        }),
        "Erro ao remover ensaio",
      );
    },
    async listPlan<TResponse = unknown>() {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api["proficiency-tests"].plan.$get(),
        "Falha ao carregar plano de participação",
      );
    },
    async createPlanItem<TResponse = unknown>(input: PtPlanItemCreateInput) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api["proficiency-tests"].plan.$post({
          json: input,
        }),
        "Erro ao criar item do plano",
      );
    },
    async updatePlanItem<TResponse = unknown>(
      id: string | number,
      input: PtPlanItemUpdateInput,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api["proficiency-tests"].plan[":id"].$put({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao atualizar item do plano",
      );
    },
    async removePlanItem<TResponse = unknown>(id: string | number) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api["proficiency-tests"].plan[":id"].$delete({
          param: { id: String(id) },
        }),
        "Erro ao remover item do plano",
      );
    },
  };
}

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
