import type {
  MySignatureResponse,
  SignaturesApi,
  SignatureDeleteResponse,
  SignatureUploadResponse,
} from "../types";
import type { CreateCloudApiClientOptions } from "../transport/cloud";
import { createCloudHeaders } from "../transport/cloud";
import { appendNamedBlob } from "../transport/form-data";
import { readJsonResponse } from "../transport/response";

export function createSignaturesApi(
  rawCloudClient: any,
  options: CreateCloudApiClientOptions,
): SignaturesApi {
  return {
    async getMine() {
      return readJsonResponse<MySignatureResponse>(
        await rawCloudClient.api.signatures["my-signature"].$get(),
        "Failed to fetch signature",
      );
    },
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

      return readJsonResponse<SignatureUploadResponse>(
        response,
        "Upload failed",
      );
    },
    async deleteMine() {
      return readJsonResponse<SignatureDeleteResponse>(
        await rawCloudClient.api.signatures["my-signature"].$delete(),
        "Failed to delete signature",
      );
    },
  };
}
