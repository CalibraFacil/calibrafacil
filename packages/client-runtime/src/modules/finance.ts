import type { FinanceApi } from "../types";
import { readJsonResponse } from "../transport/response";

type FinanceId = string | number;

type FinanceSearchInput = {
  query?: string;
};

type ListEligibleJobsInput = {
  mode: string;
  query?: string;
  limit?: string | number;
};

export function createFinanceApi(rawCloudClient: any): FinanceApi {
  return {
    async getOverview<TResponse = unknown>() {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance.overview.$get(),
        "Erro ao carregar visão geral financeira",
      );
    },
    async listDocuments<TResponse = unknown>(input: FinanceSearchInput = {}) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance.documents.$get({
          query: { query: input.query || undefined },
        }),
        "Erro ao carregar documentos",
      );
    },
    async getDocument<TResponse = unknown>(id: FinanceId) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance.documents[":id"].$get({
          param: { id: String(id) },
        }),
        "Erro ao carregar documento",
      );
    },
    async updateDocument<TResponse = unknown>(id: FinanceId, input: unknown) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance.documents[":id"].$put({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao atualizar documento",
      );
    },
    async issueDocument<TResponse = unknown>(id: FinanceId) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance.documents[":id"].issue.$post({
          param: { id: String(id) },
        }),
        "Erro ao emitir documento",
      );
    },
    async voidDocument<TResponse = unknown>(
      id: FinanceId,
      input: { reason: string },
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance.documents[":id"].void.$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao anular documento",
      );
    },
    async listEligibleJobs<TResponse = unknown>(input: ListEligibleJobsInput) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance.documents["eligible-jobs"].$get({
          query: {
            mode: input.mode,
            query: input.query || undefined,
            limit: input.limit === undefined ? undefined : String(input.limit),
          },
        }),
        "Erro ao carregar OS elegíveis",
      );
    },
    async createDocument<TResponse = unknown>(input: unknown) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance.documents.$post({ json: input }),
        "Erro ao criar documento",
      );
    },
    async listContracts<TResponse = unknown>(input: FinanceSearchInput = {}) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance.contracts.$get({
          query: { query: input.query || undefined },
        }),
        "Erro ao carregar contratos",
      );
    },
    async getContract<TResponse = unknown>(id: FinanceId) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance.contracts[":id"].$get({
          param: { id: String(id) },
        }),
        "Erro ao carregar contrato",
      );
    },
    async createContract<TResponse = unknown>(input: unknown) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance.contracts.$post({ json: input }),
        "Erro ao criar contrato",
      );
    },
    async activateContract<TResponse = unknown>(id: FinanceId) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance.contracts[":id"].activate.$post({
          param: { id: String(id) },
        }),
        "Erro ao ativar contrato",
      );
    },
    async cancelContract<TResponse = unknown>(id: FinanceId) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance.contracts[":id"].cancel.$post({
          param: { id: String(id) },
        }),
        "Erro ao cancelar contrato",
      );
    },
    async listReceipts<TResponse = unknown>() {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance.receipts.$get(),
        "Erro ao carregar recebimentos",
      );
    },
    async receiveInstallment<TResponse = unknown>(
      id: FinanceId,
      input: unknown,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance.installments[":id"].receive.$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao registrar recebimento",
      );
    },
    async listErpExports<TResponse = unknown>() {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance.erp.exports.$get(),
        "Erro ao carregar fila ERP",
      );
    },
    async exportErpDocument<TResponse = unknown>(id: FinanceId) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance.erp.documents[":id"].export.$post({
          param: { id: String(id) },
        }),
        "Erro ao exportar documento",
      );
    },
  };
}
