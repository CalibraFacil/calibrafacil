import type {
  ProfileAvatarDeleteResponse,
  ProfileAvatarUploadResponse,
  ProfileMediaApi,
} from "../types";
import type { CreateCloudApiClientOptions } from "../transport/cloud";
import { createCloudHeaders } from "../transport/cloud";
import { appendNamedBlob } from "../transport/form-data";
import { readJsonResponse } from "../transport/response";

export function createProfileMediaApi(
  options: CreateCloudApiClientOptions,
): ProfileMediaApi {
  return {
    async uploadAvatar(file, input) {
      const formData = new FormData();
      appendNamedBlob(formData, "avatar", file, input?.fileName);

      const response = await (options.fetch ?? fetch)(
        new URL("/api/profile-media/avatar", options.baseUrl),
        {
          method: "POST",
          credentials: "include",
          headers: createCloudHeaders(options.activeUnitProvider),
          body: formData,
        },
      );

      return readJsonResponse<ProfileAvatarUploadResponse>(
        response,
        "Falha ao enviar avatar",
      );
    },
    async deleteAvatar() {
      const response = await (options.fetch ?? fetch)(
        new URL("/api/profile-media/avatar", options.baseUrl),
        {
          method: "DELETE",
          credentials: "include",
          headers: createCloudHeaders(options.activeUnitProvider),
        },
      );

      return readJsonResponse<ProfileAvatarDeleteResponse>(
        response,
        "Falha ao remover avatar",
      );
    },
  };
}
