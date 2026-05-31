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

type BillingReadinessQueryInput = {
  status?: string;
  customerId?: string | number;
};

type SendBillingReadinessInput = {
  serviceOrderIds: number[];
};

type CustomerTimelineInput = {
  limit?: string | number;
};

export function createFinanceApi(rawCloudClient: any): FinanceApi {
  async function getServiceOrderStatus<TResponse = unknown>(
    serviceOrderId: FinanceId,
  ) {
    return readJsonResponse<TResponse>(
      await rawCloudClient.api.finance["service-orders"][
        ":serviceOrderId"
      ].status.$get({
        param: { serviceOrderId: String(serviceOrderId) },
      }),
      "Erro ao carregar status financeiro da OS",
    );
  }

  async function getCustomerTimeline<TResponse = unknown>(
    customerId: FinanceId,
    input: CustomerTimelineInput = {},
  ) {
    return readJsonResponse<TResponse>(
      await rawCloudClient.api.finance.customers[":customerId"].timeline.$get({
        param: { customerId: String(customerId) },
        query: {
          limit: input.limit === undefined ? undefined : String(input.limit),
        },
      }),
      "Erro ao carregar linha do tempo financeira",
    );
  }

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
    async listBillingReadiness<TResponse = unknown>(
      input: BillingReadinessQueryInput = {},
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance["billing-readiness"].$get({
          query: {
            status: input.status || undefined,
            customerId:
              input.customerId === undefined
                ? undefined
                : String(input.customerId),
          },
        }),
        "Erro ao carregar fila de faturamento",
      );
    },
    async sendBillingReadiness<TResponse = unknown>(
      input: SendBillingReadinessInput,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance["billing-readiness"].send.$post({
          json: input,
        }),
        "Erro ao enviar para o financeiro",
      );
    },
    getServiceOrderStatus,
    getCustomerTimeline,
    async getCertificateRelease<TResponse = unknown>(
      calibrationJobId: FinanceId,
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance["certificate-releases"][
          ":calibrationJobId"
        ].$get({
          param: { calibrationJobId: String(calibrationJobId) },
        }),
        "Erro ao carregar status de liberação",
      );
    },
    async releaseCertificateByException<TResponse = unknown>(
      calibrationJobId: FinanceId,
      input: { reason: string },
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance["certificate-releases"][
          ":calibrationJobId"
        ]["release-by-exception"].$post({
          param: { calibrationJobId: String(calibrationJobId) },
          json: input,
        }),
        "Erro ao liberar certificado com exceção",
      );
    },
    async listCertificateReleasePolicies<TResponse = unknown>() {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance[
          "certificate-release-policies"
        ].$get(),
        "Erro ao carregar políticas de liberação",
      );
    },
    async createCertificateReleasePolicy<TResponse = unknown>(input: {
      mode: string;
      customerId?: number | null;
      commercialAgreementId?: number | null;
      serviceCategory?: string | null;
      priority?: number;
    }) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance["certificate-release-policies"].$post({
          json: input,
        }),
        "Erro ao criar política de liberação",
      );
    },
    async updateCertificateReleasePolicy<TResponse = unknown>(
      id: FinanceId,
      input: { mode?: string; archived?: boolean; priority?: number },
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance["certificate-release-policies"][
          ":id"
        ].$put({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao atualizar política de liberação",
      );
    },
    async listAutomaticSendRules<TResponse = unknown>() {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance["automatic-send-rules"].$get(),
        "Erro ao carregar regras de envio automático",
      );
    },
    async createAutomaticSendRule<TResponse = unknown>(input: {
      milestone: string;
      customerId?: number | null;
      commercialAgreementId?: number | null;
      serviceCategory?: string | null;
      priority?: number;
    }) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance["automatic-send-rules"].$post({
          json: input,
        }),
        "Erro ao criar regra de envio automático",
      );
    },
    async updateAutomaticSendRule<TResponse = unknown>(
      id: FinanceId,
      input: { milestone?: string; archived?: boolean; priority?: number },
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance["automatic-send-rules"][":id"].$put({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao atualizar regra de envio automático",
      );
    },
    async getOperationsToCash<TResponse = unknown>(
      input: { stage?: string } = {},
    ) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance["operations-to-cash"].$get({
          query: { stage: input.stage || undefined },
        }),
        "Erro ao carregar painel operação-ao-caixa",
      );
    },
    async getRevenueLeakage<TResponse = unknown>() {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance["revenue-leakage"].$get(),
        "Erro ao carregar alertas de receita",
      );
    },
    async getCashForecast<TResponse = unknown>() {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance["cash-forecast"].$get(),
        "Erro ao carregar previsão de caixa",
      );
    },
    async getMarginDashboards<TResponse = unknown>() {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.finance["margin-dashboards"].$get(),
        "Erro ao carregar painel de margens",
      );
    },
  };
}
