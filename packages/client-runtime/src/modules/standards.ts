import {
  endpointLabel,
  standardEndpoints,
  type StandardCertificateDocumentUploadResponse,
} from "@calibra-facil/contracts";

import type { CreateCloudApiClientOptions } from "../transport/cloud";
import { createCloudHeaders } from "../transport/cloud";
import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";
import { appendNamedBlob } from "../transport/form-data";
import { createValidatedReader } from "../transport/response";

/**
 * The standards client is its endpoint group (`standardEndpoints` in
 * `@calibra-facil/contracts`) plus the one thing a JSON definition cannot
 * describe: the certificate upload is a multipart form, sent from a `File`.
 */
export type StandardsApi = Omit<
  EndpointClient<typeof standardEndpoints>,
  "uploadCertificateDocument"
> & {
  uploadCertificateDocument(
    id: string | number,
    file: Blob,
    input?: { fileName?: string },
  ): Promise<StandardCertificateDocumentUploadResponse>;
};

export function createStandardsApi(
  transport: EndpointTransport,
  options: CreateCloudApiClientOptions,
): StandardsApi {
  const client = endpointClient(standardEndpoints, transport, options);
  const validated = createValidatedReader(options);

  return {
    ...client,
    async uploadCertificateDocument(id, file, input) {
      const formData = new FormData();
      appendNamedBlob(formData, "certificate", file, input?.fileName);

      const definition = standardEndpoints.uploadCertificateDocument;
      const response = await (options.fetch ?? fetch)(
        new URL(
          `/api/standards/${encodeURIComponent(String(id))}/certificate-document`,
          options.baseUrl,
        ),
        {
          method: "POST",
          body: formData,
          credentials: "include",
          // No Content-Type: the browser sets the multipart boundary.
          headers: createCloudHeaders(options.activeUnitProvider),
        },
      );
      return validated(
        response,
        definition.response,
        endpointLabel(definition),
        definition.failure,
      );
    },
  };
}
