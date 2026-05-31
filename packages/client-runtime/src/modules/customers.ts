import type {
  CreateCustomerInput,
  CustomerAuditLogData,
  CustomerDetailData,
  CustomersApi,
  CustomersListData,
  CustomersListInput,
  UpdateCustomerComplianceInput,
  UpdateCustomerInput,
} from "../types";
import { readJsonResponse } from "../transport/response";

export function createCustomersApi(rawCloudClient: any): CustomersApi {
  return {
    async list(input: CustomersListInput) {
      return readJsonResponse<CustomersListData>(
        await rawCloudClient.api.customers.$get({
          query: {
            page: String(input.page),
            limit: String(input.limit),
            query: input.query || undefined,
          },
        }),
        "Falha ao carregar clientes",
      );
    },
    async create(input: CreateCustomerInput) {
      return readJsonResponse<CustomersListData["data"][number]>(
        await rawCloudClient.api.customers.$post({ json: input }),
        "Erro ao criar cliente",
      );
    },
    async get<TCustomer = CustomerDetailData>(id: string | number) {
      return readJsonResponse<TCustomer>(
        await rawCloudClient.api.customers[":id"].$get({
          param: { id: String(id) },
        }),
        "Falha ao carregar cliente",
      );
    },
    async update<TCustomer = CustomerDetailData>(
      id: string | number,
      input: UpdateCustomerInput,
    ) {
      return readJsonResponse<TCustomer>(
        await rawCloudClient.api.customers[":id"].$put({
          param: { id: String(id) },
          json: input,
        }),
        "Falha ao atualizar cliente",
      );
    },
    async auditLog<TRecord = unknown>(
      id: string | number,
      input: { page?: number; limit?: number } = {},
    ) {
      return readJsonResponse<CustomerAuditLogData<TRecord>>(
        await rawCloudClient.api.customers[":id"]["audit-log"].$get({
          param: { id: String(id) },
          query: {
            page: String(input.page ?? 1),
            limit: String(input.limit ?? 50),
          },
        }),
        "Falha ao carregar historico",
      );
    },
    async updateCompliance<TCustomer = CustomerDetailData>(
      id: string | number,
      input: UpdateCustomerComplianceInput,
    ) {
      return readJsonResponse<TCustomer>(
        await rawCloudClient.api.customers[":id"].compliance.$put({
          param: { id: String(id) },
          json: input,
        }),
        "Falha ao atualizar conformidade",
      );
    },
    async listMembers<TMember = unknown>(id: string | number) {
      return readJsonResponse<TMember[]>(
        await rawCloudClient.api.customers[":id"].members.$get({
          param: { id: String(id) },
        }),
        "Falha ao carregar usuarios",
      );
    },
    async listInvitations<TInvitation = unknown>(id: string | number) {
      return readJsonResponse<TInvitation[]>(
        await rawCloudClient.api.customers[":id"].invitations.$get({
          param: { id: String(id) },
        }),
        "Falha ao carregar convites",
      );
    },
    async createInvitation<TInvitation = unknown>(
      id: string | number,
      input: { email: string; role: string },
    ) {
      return readJsonResponse<TInvitation>(
        await rawCloudClient.api.customers[":id"].invitations.$post({
          param: { id: String(id) },
          json: input,
        }),
        "Falha ao enviar convite",
      );
    },
    async resendInvitation(id: string | number, invitationId: string) {
      return readJsonResponse<unknown>(
        await rawCloudClient.api.customers[":id"].invitations[
          ":invId"
        ].resend.$post({
          param: { id: String(id), invId: invitationId },
        }),
        "Falha ao reenviar convite",
      );
    },
    async cancelInvitation(id: string | number, invitationId: string) {
      return readJsonResponse<unknown>(
        await rawCloudClient.api.customers[":id"].invitations[":invId"].$delete(
          {
            param: { id: String(id), invId: invitationId },
          },
        ),
        "Falha ao cancelar convite",
      );
    },
    async removeMember(id: string | number, memberId: string) {
      return readJsonResponse<unknown>(
        await rawCloudClient.api.customers[":id"].members[":memberId"].$delete({
          param: { id: String(id), memberId },
        }),
        "Falha ao remover usuário",
      );
    },
  };
}
