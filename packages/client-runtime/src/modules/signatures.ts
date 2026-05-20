import type {
  MySignatureResponse,
  SignaturesApi,
  SignatureDeleteResponse,
  SignatureUploadResponse,
} from "../types";
import type { CreateCloudApiClientOptions } from "../transport/cloud";
import { createCloudHeaders } from "../transport/cloud";
import { appendNamedBlob } from "../transport/form-data";
import { readApiError } from "../transport/response";

export function createSignaturesApi(
  rawCloudClient: any,
  options: CreateCloudApiClientOptions,
): SignaturesApi {
  return {
    async getMine() {
      const response =
        await rawCloudClient.api.signatures["my-signature"].$get();

      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Failed to fetch signature"),
        );
      }

      return response.json() as Promise<MySignatureResponse>;
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

      if (!response.ok) {
        throw new Error(await readApiError(response, "Upload failed"));
      }

      return response.json() as Promise<SignatureUploadResponse>;
    },
    async deleteMine() {
      const response =
        await rawCloudClient.api.signatures["my-signature"].$delete();

      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Failed to delete signature"),
        );
      }

      return response.json() as Promise<SignatureDeleteResponse>;
    },
  };
}
