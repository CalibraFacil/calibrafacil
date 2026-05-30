import type {
  BackofficeAccessResponse,
  BackofficeApi,
  BackofficeBootstrapInput,
} from "../types";
import { readJsonResponse, readMutationResponse } from "../transport/response";

export function createBackofficeApi(rawCloudClient: any): BackofficeApi {
  return {
    async getAccess() {
      return readJsonResponse<BackofficeAccessResponse>(
        await rawCloudClient.api.backoffice.access.$get(),
        "Falha ao validar acesso ao backoffice",
      );
    },
    async bootstrap<TResponse = unknown>(input: BackofficeBootstrapInput) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.backoffice.bootstrap.$post({ json: input }),
        "Falha ao criar administrador",
      );
    },
    async listOrganizations<TResponse = unknown>() {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.backoffice.organizations.$get(),
        "Falha ao carregar organizações",
      );
    },
    async getOrganization<TResponse = unknown>(id: string) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.backoffice.organizations[":id"].$get({
          param: { id },
        }),
        "Falha ao carregar organização",
      );
    },
    async getSupportQueue<TResponse = unknown>() {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.backoffice.support.queue.$get(),
        "Falha ao carregar fila de suporte",
      );
    },
    async listUsers<TResponse = unknown>(input = {}) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.backoffice.users.$get({ query: input }),
        "Falha ao carregar usuários",
      );
    },
    async updateUserRole<TResponse = unknown>(id: string, role: string) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.backoffice.users[":id"].role.$post({
          param: { id },
          json: { role },
        }),
        "Falha ao atualizar papel do usuário",
      );
    },
    async banUser<TResponse = unknown>(id: string) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.backoffice.users[":id"].ban.$post({
          param: { id },
          json: {},
        }),
        "Falha ao banir usuário",
      );
    },
    async unbanUser<TResponse = unknown>(id: string) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.backoffice.users[":id"].unban.$post({
          param: { id },
        }),
        "Falha ao reabilitar usuário",
      );
    },
    async impersonateUser<TResponse = unknown>(id: string, reason: string) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.backoffice.users[":id"].impersonate.$post({
          param: { id },
          json: { reason },
        }),
        "Falha ao iniciar impersonação",
      );
    },
    async createUser<TResponse = unknown>(input: unknown) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.backoffice.users.$post({ json: input }),
        "Falha ao criar usuário interno",
      );
    },
    async provisionLab<TResponse = unknown>(input: unknown) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.backoffice.labs.$post({ json: input }),
        "Falha ao provisionar laboratório",
      );
    },
    async requestUserPasswordReset<TResponse = unknown>(id: string) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.backoffice.users[":id"][
          "request-password-reset"
        ].$post({
          param: { id },
        }),
        "Falha ao solicitar definição de senha",
      );
    },
    async listAuditLog<TResponse = unknown>(input = {}) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.backoffice["audit-log"].$get({ query: input }),
        "Falha ao carregar o log de auditoria",
      );
    },
    async getIntegrationHealth<TResponse = unknown>() {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.backoffice.integrations.health.$get(),
        "Falha ao carregar a saúde das integrações",
      );
    },
    async getVitals<TResponse = unknown>() {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.backoffice.vitals.$get(),
        "Falha ao carregar os indicadores da plataforma",
      );
    },
    async listAccountTasks<TResponse = unknown>(input = {}) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.backoffice["account-tasks"].$get({
          query: input,
        }),
        "Falha ao carregar tarefas",
      );
    },
    async createAccountTask<TResponse = unknown>(input: unknown) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.backoffice["account-tasks"].$post({
          json: input,
        }),
        "Falha ao criar tarefa",
      );
    },
    async completeAccountTask<TResponse = unknown>(id: string | number) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.backoffice["account-tasks"][
          ":id"
        ].complete.$post({
          param: { id: String(id) },
        }),
        "Falha ao concluir tarefa",
      );
    },
    commercial: {
      async listOrganizations<TResponse = unknown>(search?: string) {
        return readJsonResponse<TResponse>(
          await rawCloudClient.api.backoffice.commercial.organizations.$get({
            query: search ? { search } : {},
          }),
          "Falha ao buscar organizações",
        );
      },
      async getContext<TResponse = unknown>(organizationId: string) {
        return readJsonResponse<TResponse>(
          await rawCloudClient.api.backoffice.commercial.organizations[
            ":organizationId"
          ].context.$get({
            param: { organizationId },
          }),
          "Falha ao carregar contexto comercial",
        );
      },
      async syncBillingCustomer<TResponse = unknown>(input: unknown) {
        return readJsonResponse<TResponse>(
          await rawCloudClient.api.backoffice.commercial[
            "billing-customer"
          ].sync.$post({ json: input }),
          "Falha ao sincronizar cliente",
        );
      },
      async createBillingContact<TResponse = unknown>(input: unknown) {
        return readJsonResponse<TResponse>(
          await rawCloudClient.api.backoffice.commercial[
            "billing-contacts"
          ].$post({ json: input }),
          "Falha ao criar contato",
        );
      },
      async previewOffer<TResponse = unknown>(input: unknown) {
        return readJsonResponse<TResponse>(
          await rawCloudClient.api.backoffice.commercial.offers.preview.$post({
            json: input,
          }),
          "Falha ao gerar prévia",
        );
      },
      async issueOffer<TResponse = unknown>(input: unknown) {
        return readJsonResponse<TResponse>(
          await rawCloudClient.api.backoffice.commercial.offers.$post({
            json: input,
          }),
          "Falha ao emitir oferta",
        );
      },
      async cancelOffer<TResponse = unknown>(
        offerId: string,
        input: { reason: string },
      ) {
        return readJsonResponse<TResponse>(
          await rawCloudClient.api.backoffice.commercial.offers[
            ":offerId"
          ].cancel.$post({
            param: { offerId },
            json: input,
          }),
          "Falha ao cancelar oferta",
        );
      },
      async reissueOffer<TResponse = unknown>(offerId: string, input: unknown) {
        return readJsonResponse<TResponse>(
          await rawCloudClient.api.backoffice.commercial.offers[
            ":offerId"
          ].reissue.$post({
            param: { offerId },
            json: input,
          }),
          "Falha ao reemitir oferta",
        );
      },
    },
    customerSuccess: {
      async listOrganizations<TResponse = unknown>() {
        return readJsonResponse<TResponse>(
          await rawCloudClient.api.backoffice[
            "customer-success"
          ].organizations.$get(),
          "Falha ao carregar contas",
        );
      },
      async getProfile<TResponse = unknown>(organizationId: string) {
        return readJsonResponse<TResponse>(
          await rawCloudClient.api.backoffice["customer-success"].organizations[
            ":id"
          ].profile.$get({
            param: { id: organizationId },
          }),
          "Falha ao carregar detalhe da conta",
        );
      },
      async getRequests<TResponse = unknown>(organizationId: string) {
        return readJsonResponse<TResponse>(
          await rawCloudClient.api.backoffice["customer-success"].organizations[
            ":id"
          ].requests.$get({
            param: { id: organizationId },
          }),
          "Falha ao carregar tickets da conta",
        );
      },
      async updateProfile<TResponse = unknown>(
        organizationId: string,
        input: unknown,
      ) {
        return readJsonResponse<TResponse>(
          await rawCloudClient.api.backoffice["customer-success"].organizations[
            ":id"
          ].profile.$put({
            param: { id: organizationId },
            json: input,
          }),
          "Falha ao atualizar perfil operacional",
        );
      },
      async updateRequestStatus<TResponse = unknown>(
        requestId: string | number,
        input: unknown,
      ) {
        return readJsonResponse<TResponse>(
          await rawCloudClient.api.backoffice["customer-success"].requests[
            ":id"
          ].status.$post({
            param: { id: String(requestId) },
            json: input,
          }),
          "Falha ao atualizar status",
        );
      },
      async assignRequest<TResponse = unknown>(
        requestId: string | number,
        input: unknown,
      ) {
        return readJsonResponse<TResponse>(
          await rawCloudClient.api.backoffice["customer-success"].requests[
            ":id"
          ].assign.$post({
            param: { id: String(requestId) },
            json: input,
          }),
          "Falha ao atribuir ticket",
        );
      },
      async respondRequest<TResponse = unknown>(
        requestId: string | number,
        input: unknown,
      ) {
        return readJsonResponse<TResponse>(
          await rawCloudClient.api.backoffice["customer-success"].requests[
            ":id"
          ].respond.$post({
            param: { id: String(requestId) },
            json: input,
          }),
          "Falha ao responder",
        );
      },
      async escalateRequest<TResponse = unknown>(
        requestId: string | number,
        input: unknown,
      ) {
        return readJsonResponse<TResponse>(
          await rawCloudClient.api.backoffice["customer-success"].requests[
            ":id"
          ].escalate.$post({
            param: { id: String(requestId) },
            json: input,
          }),
          "Falha ao escalar ticket",
        );
      },
      async updateNextAction<TResponse = unknown>(
        organizationId: string,
        input: unknown,
      ) {
        return readJsonResponse<TResponse>(
          await rawCloudClient.api.backoffice["customer-success"].organizations[
            ":id"
          ]["next-action"].$post({
            param: { id: organizationId },
            json: input,
          }),
          "Falha ao atualizar próxima ação",
        );
      },
      async updateBlocker<TResponse = unknown>(
        organizationId: string,
        input: unknown,
      ) {
        return readJsonResponse<TResponse>(
          await rawCloudClient.api.backoffice["customer-success"].organizations[
            ":id"
          ].block.$post({
            param: { id: organizationId },
            json: input,
          }),
          "Falha ao atualizar bloqueio",
        );
      },
    },
    async stopImpersonation() {
      await readMutationResponse(
        await rawCloudClient.api.backoffice.impersonation.stop.$post(),
        "Erro ao parar impersonação",
      );
      return { ok: true };
    },
  };
}
