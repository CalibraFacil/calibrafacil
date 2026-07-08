import type { PublicLeadsApi } from "../types";
import { readJsonResponse } from "../transport/response";

export function createPublicLeadsApi(rawCloudClient: any): PublicLeadsApi {
  return {
    async create<TResponse = unknown, TInput = unknown>(input: TInput) {
      return readJsonResponse<TResponse>(
        await rawCloudClient.api.public.leads.$post({ json: input }),
        "Falha ao registrar seu contato",
      );
    },
  };
}
