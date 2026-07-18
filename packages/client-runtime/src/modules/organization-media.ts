import type {
  OrganizationLogoDeleteResponse,
  OrganizationLogoUploadResponse,
  OrganizationMediaApi,
} from "../types";
import type { CreateCloudApiClientOptions } from "../transport/cloud";
import { createCloudHeaders } from "../transport/cloud";
import { appendNamedBlob } from "../transport/form-data";
import { readJsonResponse } from "../transport/response";

export function createOrganizationMediaApi(
  options: CreateCloudApiClientOptions,
): OrganizationMediaApi {
  return {
    async uploadLogo(file, input) {
      const formData = new FormData();
      appendNamedBlob(formData, "logo", file, input?.fileName);

      const response = await (options.fetch ?? fetch)(
        new URL("/api/organization-media/logo", options.baseUrl),
        {
          method: "POST",
          credentials: "include",
          headers: createCloudHeaders(options.activeUnitProvider),
          body: formData,
        },
      );

      return readJsonResponse<OrganizationLogoUploadResponse>(
        response,
        "Falha ao enviar logo",
      );
    },
    async deleteLogo() {
      const response = await (options.fetch ?? fetch)(
        new URL("/api/organization-media/logo", options.baseUrl),
        {
          method: "DELETE",
          credentials: "include",
          headers: createCloudHeaders(options.activeUnitProvider),
        },
      );

      return readJsonResponse<OrganizationLogoDeleteResponse>(
        response,
        "Falha ao remover logo",
      );
    },
  };
}
