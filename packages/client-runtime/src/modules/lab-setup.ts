import type { LabSetupApi, LabSetupMetadata } from "../types";
import { CalibraApiError } from "../transport/errors";
import { readJsonResponse } from "../transport/response";

export function createLabSetupApi(rawCloudClient: any): LabSetupApi {
  return {
    async get(token) {
      const response = await rawCloudClient.api["lab-setup"][":token"].$get({
        param: { token },
      });
      const payload: unknown = await response.json().catch(() => null);

      if (response.ok && isLabSetupMetadata(payload)) {
        return payload;
      }

      if (!response.ok && isLabSetupMetadata(payload)) {
        return payload;
      }

      throw new CalibraApiError(
        "Falha ao carregar configuração de acesso",
        response.status,
        payload,
      );
    },
    async requestMagicLink(token) {
      return readJsonResponse(
        await rawCloudClient.api["lab-setup"][":token"][
          "request-magic-link"
        ].$post({
          param: { token },
        }),
        "Falha ao enviar link mágico",
      );
    },
    async requestOtp(token) {
      return readJsonResponse(
        await rawCloudClient.api["lab-setup"][":token"]["request-otp"].$post({
          param: { token },
        }),
        "Falha ao enviar código",
      );
    },
    async complete(token) {
      return readJsonResponse(
        await rawCloudClient.api["lab-setup"][":token"].complete.$post({
          param: { token },
        }),
        "Falha ao concluir acesso",
      );
    },
  };
}

function isLabSetupMetadata(value: unknown): value is LabSetupMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = Object.fromEntries(Object.entries(value));
  return (
    isLabSetupStatus(record.status) &&
    record.passkeyPreferred === true &&
    Array.isArray(record.fallbackMethods) &&
    record.fallbackMethods.every(isLabSetupFallbackMethod)
  );
}

function isLabSetupStatus(value: unknown) {
  return (
    value === "ready" ||
    value === "invalid" ||
    value === "expired" ||
    value === "consumed" ||
    value === "user_invalid" ||
    value === "email_mismatch" ||
    value === "organization_invalid" ||
    value === "membership_missing" ||
    value === "invitation_invalid"
  );
}

function isLabSetupFallbackMethod(value: unknown) {
  return value === "magic_link" || value === "email_otp";
}
