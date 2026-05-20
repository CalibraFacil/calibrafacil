import type { DashboardUnitsResponse, UnitsApi } from "../types";
import {
  readMutationResponse,
  readOptionalForbiddenResponse,
} from "../transport/response";

export function createUnitsApi(rawCloudClient: any): UnitsApi {
  return {
    async getDashboardUnits() {
      const response = await rawCloudClient.api.units.$get();

      if (response.status === 403) {
        return null;
      }

      if (!response.ok) {
        throw new Error("Falha ao carregar unidades");
      }

      return response.json() as Promise<DashboardUnitsResponse>;
    },
    async listAdminUnits<TResponse = unknown>() {
      return readOptionalForbiddenResponse<TResponse>(
        await rawCloudClient.api.units.admin.units.$get(),
        emptyGovernanceResponse(),
        "Falha ao carregar unidades",
      );
    },
    async listAdminMembers<TResponse = unknown>() {
      return readOptionalForbiddenResponse<TResponse>(
        await rawCloudClient.api.units.admin.members.$get(),
        emptyGovernanceResponse(),
        "Falha ao carregar governança por unidade",
      );
    },
    async listAdminActivity<TResponse = unknown>() {
      return readOptionalForbiddenResponse<TResponse>(
        await rawCloudClient.api.units.admin.activity.$get(),
        emptyGovernanceResponse(),
        "Falha ao carregar atividade de governança",
      );
    },
    async createAdminUnit<TResponse = unknown>(name: string) {
      return readMutationResponse<TResponse>(
        await rawCloudClient.api.units.admin.units.$post({ json: { name } }),
        "Erro ao criar unidade",
      );
    },
    async updateAdminUnit<TResponse = unknown>(
      unitId: number,
      payload: { name?: string; status?: "ACTIVE" | "ARCHIVED" },
    ) {
      return readMutationResponse<TResponse>(
        await rawCloudClient.api.units.admin.units[":id"].$patch({
          param: { id: String(unitId) },
          json: payload,
        }),
        "Erro ao atualizar unidade",
      );
    },
    async updateMemberAssignments<TResponse = unknown>(
      memberId: string,
      assignments: Array<{
        unitId: number;
        role: "member" | "technician" | "unit_admin";
      }>,
    ) {
      return readMutationResponse<TResponse>(
        await rawCloudClient.api.units.admin.members[
          ":memberId"
        ].assignments.$put({
          param: { memberId },
          json: { assignments },
        }),
        "Erro ao atualizar atribuições",
      );
    },
    async updateMemberRole<TResponse = unknown>(
      memberId: string,
      role: string,
    ) {
      return readMutationResponse<TResponse>(
        await rawCloudClient.api.units.admin.members[":memberId"].role.$patch({
          param: { memberId },
          json: { role },
        }),
        "Erro ao atualizar papel global",
      );
    },
  };
}

function emptyGovernanceResponse() {
  return {
    data: [],
    viewer: {
      isGlobalManager: false,
      canManageOrganizationUnits: false,
      canManageAssignments: false,
      canManageGlobalRoles: false,
      canViewGovernance: false,
      canAccessConsolidatedView: false,
      managedUnitIds: [],
    },
  };
}
