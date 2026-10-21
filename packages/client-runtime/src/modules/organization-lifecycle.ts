import type {
  OrganizationLifecycleApi,
  SoftDeleteOrganizationResponse,
} from "../types";
import { readJsonResponse } from "../transport/response";

export function createOrganizationLifecycleApi(
  rawCloudClient: any,
): OrganizationLifecycleApi {
  return {
    async softDelete(input) {
      return readJsonResponse<SoftDeleteOrganizationResponse>(
        await rawCloudClient.api.organization["soft-delete"].$post({
          json: input,
        }),
        "Falha ao excluir a organização",
      );
    },
  };
}
