import type {
  CreateCustomerGroupInput,
  CustomerGroupDetailData,
  CustomerGroupsApi,
  CustomerGroupsListData,
} from "../types";
import { readJsonResponse } from "../transport/response";

// Customer groups are a cloud-only lab feature (consolidated multi-unit portal).
// oxlint-disable-next-line typescript/no-explicit-any -- raw Hono RPC client, typed by contracts AppType.
export function createCustomerGroupsApi(
  rawCloudClient: any,
): CustomerGroupsApi {
  const groups = rawCloudClient.api["customer-groups"];
  return {
    async list() {
      return readJsonResponse<CustomerGroupsListData>(
        await groups.$get(),
        "Falha ao carregar grupos de clientes",
      );
    },
    async get(id) {
      return readJsonResponse<CustomerGroupDetailData>(
        await groups[":id"].$get({ param: { id: String(id) } }),
        "Falha ao carregar grupo",
      );
    },
    async create(input: CreateCustomerGroupInput) {
      return readJsonResponse<
        CustomerGroupDetailData & { invitationId: string | null }
      >(await groups.$post({ json: input }), "Erro ao criar grupo");
    },
    async addBranch(groupId, customerId) {
      return readJsonResponse<{ success: boolean }>(
        await groups[":id"].branches.$post({
          param: { id: String(groupId) },
          json: { customerId },
        }),
        "Erro ao vincular cliente ao grupo",
      );
    },
    async removeBranch(groupId, customerId) {
      return readJsonResponse<{ success: boolean }>(
        await groups[":id"].branches[":customerId"].$delete({
          param: { id: String(groupId), customerId: String(customerId) },
        }),
        "Erro ao desvincular cliente do grupo",
      );
    },
    async listMembers<TMember = unknown>(id: string | number) {
      return readJsonResponse<TMember[]>(
        await groups[":id"].members.$get({ param: { id: String(id) } }),
        "Falha ao carregar gestores",
      );
    },
    async listInvitations<TInvitation = unknown>(id: string | number) {
      return readJsonResponse<TInvitation[]>(
        await groups[":id"].invitations.$get({ param: { id: String(id) } }),
        "Falha ao carregar convites",
      );
    },
    async createInvitation<TInvitation = unknown>(
      id: string | number,
      input: { email: string; role: string },
    ) {
      return readJsonResponse<TInvitation>(
        await groups[":id"].invitations.$post({
          param: { id: String(id) },
          json: input,
        }),
        "Falha ao enviar convite",
      );
    },
    async resendInvitation(id: string | number, invitationId: string) {
      return readJsonResponse<unknown>(
        await groups[":id"].invitations[":invId"].resend.$post({
          param: { id: String(id), invId: invitationId },
        }),
        "Falha ao reenviar convite",
      );
    },
    async cancelInvitation(id: string | number, invitationId: string) {
      return readJsonResponse<unknown>(
        await groups[":id"].invitations[":invId"].$delete({
          param: { id: String(id), invId: invitationId },
        }),
        "Falha ao cancelar convite",
      );
    },
    async removeMember(id: string | number, memberId: string) {
      return readJsonResponse<unknown>(
        await groups[":id"].members[":memberId"].$delete({
          param: { id: String(id), memberId },
        }),
        "Falha ao remover gestor",
      );
    },
  };
}
