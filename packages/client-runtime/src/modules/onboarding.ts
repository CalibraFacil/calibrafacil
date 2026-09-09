import type { ActivationChecklistResponse, OnboardingApi } from "../types";
import { readJsonResponse } from "../transport/response";

export function createOnboardingApi(rawCloudClient: any): OnboardingApi {
  return {
    async getChecklist() {
      return readJsonResponse<ActivationChecklistResponse>(
        await rawCloudClient.api.onboarding.checklist.$get(),
        "Erro ao carregar a configuração inicial",
      );
    },
  };
}
