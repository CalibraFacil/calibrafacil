import type {
  SigningCertificateActionResponse,
  SigningCertificatesApi,
  SigningCertificatesListResponse,
  UploadSigningCertificateInput,
  UploadSigningCertificateResponse,
} from "../types";
import { readApiError } from "../transport/response";

export function createSigningCertificatesApi(
  rawCloudClient: any,
): SigningCertificatesApi {
  return {
    async list() {
      const response = await rawCloudClient.api.signing.certificates.$get();

      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Failed to fetch certificates"),
        );
      }

      return response.json() as Promise<SigningCertificatesListResponse>;
    },
    async upload(input: UploadSigningCertificateInput) {
      const response = await rawCloudClient.api.signing.certificates.$post({
        json: input,
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "Upload failed"));
      }

      return response.json() as Promise<UploadSigningCertificateResponse>;
    },
    async setDefault(id) {
      const response = await rawCloudClient.api.signing.certificates[":id"][
        "set-default"
      ].$post({
        param: { id: String(id) },
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "Failed to set default"));
      }

      return response.json() as Promise<SigningCertificateActionResponse>;
    },
    async revoke(id, reason) {
      const response = await rawCloudClient.api.signing.certificates[
        ":id"
      ].$delete({
        param: { id: String(id) },
        json: { reason },
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "Failed to revoke"));
      }

      return response.json() as Promise<SigningCertificateActionResponse>;
    },
  };
}
