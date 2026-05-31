import type {
  CertificateNumberingApi,
  CertificateNumberingProfileResponse,
  UpdateCertificateNumberingProfileResponse,
} from "../types";
import { readJsonResponse } from "../transport/response";

export function createCertificateNumberingApi(
  rawCloudClient: any,
): CertificateNumberingApi {
  return {
    async getProfile() {
      return readJsonResponse<CertificateNumberingProfileResponse>(
        await rawCloudClient.api["certificate-numbering"].$get(),
        "Falha ao carregar perfil de numeração",
      );
    },
    async updateProfile(input) {
      return readJsonResponse<UpdateCertificateNumberingProfileResponse>(
        await rawCloudClient.api["certificate-numbering"].$put({
          json: input,
        }),
        "Falha ao salvar perfil",
      );
    },
  };
}
