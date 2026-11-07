import { sessionEndpoints } from "@calibra-facil/contracts";
import type { ResponseValidationOptions } from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The sessions client is its endpoint group (`sessionEndpoints` in `@calibra-facil/contracts`). */
export type SessionsApi = EndpointClient<typeof sessionEndpoints>;

export function createSessionsApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): SessionsApi {
  return endpointClient(sessionEndpoints, transport, options);
}
