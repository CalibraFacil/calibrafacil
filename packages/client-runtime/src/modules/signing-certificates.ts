import type {
  SigningCertificateActionResponse,
  SigningCertificatesApi,
  SigningCertificatesListResponse,
  UploadSigningCertificateInput,
  UploadSigningCertificateResponse,
} from "../types";
import { readJsonResponse } from "../transport/response";

export function createSigningCertificatesApi(
  rawCloudClient: any,
): SigningCertificatesApi {
  return {
    async list() {
      return readJsonResponse<SigningCertificatesListResponse>(
        await rawCloudClient.api.signing.certificates.$get(),
        "Failed to fetch certificates",
      );
    },
    async upload(input: UploadSigningCertificateInput) {
      return readJsonResponse<UploadSigningCertificateResponse>(
        await rawCloudClient.api.signing.certificates.$post({
          json: input,
        }),
        "Upload failed",
      );
    },
    async setDefault(id) {
      return readJsonResponse<SigningCertificateActionResponse>(
        await rawCloudClient.api.signing.certificates[":id"][
          "set-default"
        ].$post({
          param: { id: String(id) },
        }),
        "Failed to set default",
      );
    },
    async revoke(id, reason) {
      return readJsonResponse<SigningCertificateActionResponse>(
        await rawCloudClient.api.signing.certificates[":id"].$delete({
          param: { id: String(id) },
          json: { reason },
        }),
        "Failed to revoke",
      );
    },
  };
}
