import { onboardingEndpoints } from "@calibra-facil/contracts";
import type { ResponseValidationOptions } from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The onboarding client is its endpoint group (`onboardingEndpoints` in `@calibra-facil/contracts`). */
export type OnboardingApi = EndpointClient<typeof onboardingEndpoints>;

export function createOnboardingApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): OnboardingApi {
  return endpointClient(onboardingEndpoints, transport, options);
}
