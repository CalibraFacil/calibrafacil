import {
  endpointLabel,
  signatureEndpoints,
  validateResponsePayload,
  type SignatureUploadResponse,
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
 * The signatures client is its endpoint group (`signatureEndpoints` in
 * `@calibra-facil/contracts`) plus the one thing that is client-side logic:
 * the upload is a multipart form, which the JSON endpoint client does not send.
 */
export type SignaturesApi = Omit<
  EndpointClient<typeof signatureEndpoints>,
  "uploadMine"
> & {
  uploadMine(
    file: Blob,
    input?: { fileName?: string },
  ): Promise<SignatureUploadResponse>;
};

export function createSignaturesApi(
  transport: EndpointTransport,
  options: CreateCloudApiClientOptions,
): SignaturesApi {
  const { uploadMine: _jsonUpload, ...client } = endpointClient(
    signatureEndpoints,
    transport,
    options,
  );

  return {
    ...client,
    async uploadMine(file, input) {
      const formData = new FormData();
      appendNamedBlob(formData, "signature", file, input?.fileName);

      const response = await (options.fetch ?? fetch)(
        new URL("/api/signatures/my-signature", options.baseUrl),
        {
          method: "POST",
          credentials: "include",
          headers: createCloudHeaders(options.activeUnitProvider),
          body: formData,
        },
      );

      const def = signatureEndpoints.uploadMine;
      return validateResponsePayload(
        def.response,
        await readJsonResponse(response, def.failure),
        endpointLabel(def),
        options,
      );
    },
  };
}
