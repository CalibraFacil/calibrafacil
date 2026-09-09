import type { PublicSignupApi, SelfServeSignupResponse } from "../types";
import { readJsonResponse } from "../transport/response";

/**
 * Public, unauthenticated self-serve sign-up. Called before any session
 * exists, so it carries no identity — the API answers with a claim e-mail.
 */
export function createPublicSignupApi(rawCloudClient: any): PublicSignupApi {
  return {
    async start<TInput = unknown>(input: TInput) {
      return readJsonResponse<SelfServeSignupResponse>(
        await rawCloudClient.api.public.signup.$post({ json: input }),
        "Falha ao criar a conta",
      );
    },
  };
}
