import type { PublicInvitationsApi } from "../types";
import { readJsonResponse } from "../transport/response";

export function createPublicInvitationsApi(
  rawCloudClient: any,
): PublicInvitationsApi {
  return {
    async get<TResponse = unknown>(id: string) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.invitations[":id"].$get({
          param: { id },
        }),
        "Falha ao carregar o convite",
      );
    },
    async requestSetupLink<TResponse = unknown>(id: string) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.invitations[":id"]["request-setup-link"].$post(
          {
            param: { id },
          },
        ),
        "Falha ao enviar link de acesso",
      );
    },
  };
}
