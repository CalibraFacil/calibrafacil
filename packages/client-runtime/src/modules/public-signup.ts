import { publicSignupEndpoints } from "@calibra-facil/contracts";
import type { ResponseValidationOptions } from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The public sign-up client is its endpoint group (`publicSignupEndpoints` in `@calibra-facil/contracts`). */
export type PublicSignupApi = EndpointClient<typeof publicSignupEndpoints>;

export function createPublicSignupApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): PublicSignupApi {
  return endpointClient(publicSignupEndpoints, transport, options);
}
