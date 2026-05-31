import type { SessionsApi } from "../types";
import { readMutationResponse } from "../transport/response";

export function createSessionsApi(rawCloudClient: any): SessionsApi {
  return {
    async revoke(sessionId) {
      return readMutationResponse(
        await rawCloudClient.api.sessions.revoke.$post({
          json: { sessionId },
        }),
        "Falha ao encerrar sessao",
      );
    },
  };
}
