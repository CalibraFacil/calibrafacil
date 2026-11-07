import {
  endpointLabel,
  organizationMediaEndpoints,
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
 * The organization-media client is its endpoint group
 * (`organizationMediaEndpoints` in `@calibra-facil/contracts`) plus the one
 * thing that is client-side logic: the upload is a multipart form, which the
 * JSON endpoint client does not send.
 */
export type OrganizationMediaApi = Omit<
  EndpointClient<typeof organizationMediaEndpoints>,
  "uploadLogo"
> & {
  uploadLogo(
    file: Blob,
    input?: { fileName?: string },
  ): Promise<{ logoUrl: string }>;
};

export function createOrganizationMediaApi(
  transport: EndpointTransport,
  options: CreateCloudApiClientOptions & ResponseValidationOptions,
): OrganizationMediaApi {
  const { uploadLogo: _jsonUpload, ...client } = endpointClient(
    organizationMediaEndpoints,
    transport,
    options,
  );

  return {
    ...client,
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

      const def = organizationMediaEndpoints.uploadLogo;
      return validateResponsePayload(
        def.response,
        await readJsonResponse(response, def.failure),
        endpointLabel(def),
        options,
      );
    },
  };
}
