import type { PublicCheckoutApi } from "../types";
import { readJsonResponse } from "../transport/response";

export function createPublicCheckoutApi(
  rawCloudClient: any,
): PublicCheckoutApi {
  return {
    async getSnapshot<TResponse = unknown>(token: string) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.public["commercial-checkout"][":token"].$get({
          param: { token },
        }),
        "Falha ao carregar a oferta comercial",
      );
    },
    async getStatus<TResponse = unknown>(token: string) {
      const response = await rawCloudClient.api.public["commercial-checkout"][
        ":token"
      ].status.$get({ param: { token } });

      if (response.status === 404) {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- generic callers choose the status DTO shape; INVALID is the stable 404 payload.
        return { state: "INVALID" } as TResponse;
      }

      return readJsonResponse<TResponse>(
        response,
        "Falha ao verificar o status do pagamento",
      );
    },
    async start<TResponse = unknown>(token: string) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.public["commercial-checkout"][
          ":token"
        ].start.$post({
          param: { token },
        }),
        "Falha ao iniciar o pagamento",
      );
    },
  };
}
