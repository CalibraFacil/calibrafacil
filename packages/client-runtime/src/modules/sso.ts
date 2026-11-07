import { ssoEndpoints } from "@calibra-facil/contracts";
import type { ResponseValidationOptions } from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The single sign-on client is its endpoint group (`ssoEndpoints` in `@calibra-facil/contracts`). */
export type SsoApi = EndpointClient<typeof ssoEndpoints>;

export function createSsoApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): SsoApi {
  return endpointClient(ssoEndpoints, transport, options);
}
