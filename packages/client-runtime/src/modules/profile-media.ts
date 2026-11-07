import {
  endpointLabel,
  profileMediaEndpoints,
  validateResponsePayload,
  type ResponseValidationOptions,
} from "@calibra-facil/contracts";

import type { CreateCloudApiClientOptions } from "../transport/cloud";
import { createCloudHeaders } from "../transport/cloud";
import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";
import { appendNamedBlob } from "../transport/form-data";
import { readJsonResponse } from "../transport/response";

/**
 * The profile-media client is its endpoint group (`profileMediaEndpoints` in
 * `@calibra-facil/contracts`) plus the one thing that is client-side logic: the
 * upload is a multipart form, which the JSON endpoint client does not send.
 */
export type ProfileMediaApi = Omit<
  EndpointClient<typeof profileMediaEndpoints>,
  "uploadAvatar"
> & {
  uploadAvatar(
    file: Blob,
    input?: { fileName?: string },
  ): Promise<{ imageUrl: string }>;
};

export function createProfileMediaApi(
  transport: EndpointTransport,
  options: CreateCloudApiClientOptions & ResponseValidationOptions,
): ProfileMediaApi {
  const { uploadAvatar: _jsonUpload, ...client } = endpointClient(
    profileMediaEndpoints,
    transport,
    options,
  );

  return {
    ...client,
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

      const def = profileMediaEndpoints.uploadAvatar;
      return validateResponsePayload(
        def.response,
        await readJsonResponse(response, def.failure),
        endpointLabel(def),
        options,
      );
    },
  };
}
