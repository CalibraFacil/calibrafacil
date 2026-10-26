import type {
  OrganizationProfileApi,
  OrganizationProfileResponse,
} from "../types";
import { readJsonResponse } from "../transport/response";

export function createOrganizationProfileApi(
  rawCloudClient: any,
): OrganizationProfileApi {
  return {
    async update(input) {
      return readJsonResponse<OrganizationProfileResponse>(
        await rawCloudClient.api.organization.profile.$patch({
          json: input,
        }),
        "Falha ao atualizar o perfil do laboratório",
      );
    },
  };
}
