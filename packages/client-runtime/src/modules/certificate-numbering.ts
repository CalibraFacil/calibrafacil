import type {
  CertificateNumberingApi,
  CertificateNumberingProfileResponse,
  UpdateCertificateNumberingProfileResponse,
} from "../types";
import { readApiError } from "../transport/response";

export function createCertificateNumberingApi(
  rawCloudClient: any,
): CertificateNumberingApi {
  return {
    async getProfile() {
      const response = await rawCloudClient.api["certificate-numbering"].$get();

      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Falha ao carregar perfil de numeração"),
        );
      }

      return response.json() as Promise<CertificateNumberingProfileResponse>;
    },
    async updateProfile(input) {
      const response = await rawCloudClient.api["certificate-numbering"].$put({
        json: input,
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "Falha ao salvar perfil"));
      }

      return response.json() as Promise<UpdateCertificateNumberingProfileResponse>;
    },
  };
}
